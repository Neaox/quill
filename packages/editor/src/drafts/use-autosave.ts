import { useCallback, useEffect, useRef, useState } from 'react'
import type { Clock } from './clock.ts'
import { systemClock } from './clock.ts'
import type { DocumentAst, DraftClient, LockHolder } from './clients.ts'
import type { PendingDraft, RecoveryStore } from './recovery-store.ts'

/** ADR-021: edits are debounced, not sent per keystroke. */
export const AUTOSAVE_DEBOUNCE_MS = 1000

/**
 * `stale` and `blocked` are the two server conflicts R5 insists stay distinct:
 * `stale` means re-read and retry, `blocked` means stop and enter recovery.
 */
export type AutosaveStatus =
  | 'idle'
  | 'pending'
  | 'saving'
  | 'saved'
  | 'stale'
  | 'blocked'
  | 'signed_out'

export interface UseAutosaveOptions {
  readonly client: DraftClient
  readonly store: RecoveryStore
  /** The version last acknowledged by the server; re-reading after a conflict raises it. */
  readonly documentVersion: number
  /** Wire the lock's `canAutosave` here. */
  readonly canSave: boolean
  readonly clock?: Clock
  readonly debounceMs?: number
}

export interface Autosave {
  readonly status: AutosaveStatus
  readonly draftVersion: number
  readonly lastSavedAt: number | null
  readonly pending: PendingDraft | undefined
  readonly holder: LockHolder | null
  /** Queue an edit. Debounced; the entry is written to the recovery store BEFORE any network call. */
  change(ast: DocumentAst): void
  /** Flush now (navigation, explicit save), ignoring the debounce and the current status. */
  flush(): Promise<void>
}

/**
 * The autosave loop of ADR-021: buffer locally, debounce, write the draft, and pop
 * the buffer only on an acknowledgement. Every failure path keeps the buffered edit.
 */
export function useAutosave(options: UseAutosaveOptions): Autosave {
  const { client, store, documentVersion, canSave } = options
  const clock = options.clock ?? systemClock
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS

  // An entry left over from a previous session is already pending: it never reached
  // the server, so mounting must pick it up rather than start from a clean slate.
  const [entry, setEntry] = useState<PendingDraft | undefined>(() => store.read())
  const [status, setStatus] = useState<AutosaveStatus>(() =>
    store.read() === undefined ? 'idle' : 'pending',
  )
  const [acknowledgedVersion, setAcknowledgedVersion] = useState(documentVersion)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [holder, setHolder] = useState<LockHolder | null>(null)
  const savingRef = useRef(false)

  // A re-read after a stale conflict arrives as a higher `documentVersion` prop; our
  // own acknowledgements arrive from the save response. The later of the two wins.
  const draftVersion = Math.max(documentVersion, acknowledgedVersion)

  const save = useCallback(async (): Promise<void> => {
    if (!canSave || savingRef.current) return
    const queued = store.read()
    if (queued === undefined) return

    savingRef.current = true
    setStatus('saving')
    const result = await client.save(queued.ast, queued.expectedVersion)
    savingRef.current = false

    switch (result.status) {
      case 'saved': {
        setAcknowledgedVersion(result.draftVersion)
        setLastSavedAt(result.updatedAt)
        // An edit made while this save was in flight replaced the buffered entry;
        // clearing here would throw it away, so leave it queued for the next round.
        if (store.read() !== queued) {
          setStatus('pending')
          return
        }
        store.clear()
        setEntry(undefined)
        setStatus('saved')
        return
      }
      case 'stale_version':
        // We still hold the lock; the caller re-reads and hands back a fresh version.
        setStatus('stale')
        return
      case 'lock_lost':
        setHolder(result.holder)
        setStatus('blocked')
        return
      case 'session_expired':
        setStatus('signed_out')
        return
    }
  }, [canSave, client, store])

  // Debounces a buffered edit against a `clock.setTimeout` timer before flushing
  // it to the DraftClient over the network — the external system this effect
  // synchronises with (ADR-021).
  useEffect(() => {
    // `stale`, `blocked` and `signed_out` deliberately stop the loop: each needs the
    // caller to act, and retrying against a version or a lock we know is wrong is
    // exactly what ADR-021 forbids.
    if (entry === undefined || !canSave || status !== 'pending') return undefined
    const handle = clock.setTimeout(() => void save(), debounceMs)
    return () => {
      clock.clearTimeout(handle)
    }
  }, [canSave, clock, debounceMs, entry, save, status])

  const change = (ast: DocumentAst): void => {
    const next: PendingDraft = { ast, expectedVersion: draftVersion, savedAt: clock.now() }
    // Buffer first: a crash between here and the response must still be recoverable.
    store.write(next)
    setEntry(next)
    if (!savingRef.current) setStatus('pending')
  }

  return { status, draftVersion, lastSavedAt, pending: entry, holder, change, flush: save }
}
