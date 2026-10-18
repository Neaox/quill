import { useCallback, useEffect, useRef, useState } from 'react'

import { contentKey, mergeDocuments, resolveMerge } from '@quill/markdown'
import type { ConflictResolution, DocumentMerge } from '@quill/markdown'

import type { Clock } from './clock.ts'
import { systemClock } from './clock.ts'
import type { DocumentAst, DraftClient, LoadedDraft } from './clients.ts'
import type { ReconcileEvent, ReconcilePhase } from './reconcile-machine.ts'
import { IDLE, reconcileNeed, reconcileReducer } from './reconcile-machine.ts'
import type { DraftBase, RecoveryStore } from './recovery-store.ts'
import type { Autosave } from './use-autosave.ts'
import type { DocumentLock } from './use-document-lock.ts'
import { HEARTBEAT_INTERVAL_MS } from './use-document-lock.ts'

/**
 * Runs the three-way merge: on this thread, or in a worker for a large
 * document (`@quill/markdown/merge-worker`). Asynchronous either way, so the
 * caller never knows which.
 */
export type MergeRunner = (
  base: DocumentAst,
  mine: DocumentAst,
  theirs: DocumentAst,
) => Promise<DocumentMerge>

export const mergeOnThisThread: MergeRunner = async (base, mine, theirs) =>
  mergeDocuments(base, mine, theirs)

/** A failed read of the server's draft is tried again after this long. */
export const RECONCILE_RETRY_MS = 5000

/** Edits typed while a merge runs are merged in by running it again, at most this often. */
const MERGE_PASSES = 3

const EMPTY_DOCUMENT: DocumentAst = { type: 'root', children: [] }

export interface UseDraftReconciliationOptions {
  readonly lock: DocumentLock
  readonly autosave: Autosave
  readonly client: DraftClient
  readonly store: RecoveryStore
  readonly merge?: MergeRunner
  readonly clock?: Clock
  /** How often to ask for a lock somebody else holds; the heartbeat's 15 s by default. */
  readonly waitIntervalMs?: number
  /** Puts a tree in the editor: the merge, or the server's draft. */
  readonly onReplace: (ast: DocumentAst) => void
  /** Offline changes were merged with `theirs` and are being saved. */
  readonly onMerged: (theirs: LoadedDraft) => void
}

export interface DraftReconciliation {
  readonly phase: ReconcilePhase
  /** Settles a conflicted merge, one resolution per conflict, in order. */
  resolve(resolutions: readonly ConflictResolution[]): void
  /** Settles a conflicted merge by saving this author's draft over theirs. */
  keepMine(): void
}

const baseOf = (theirs: LoadedDraft): DraftBase => ({
  ast: theirs.ast,
  draftVersion: theirs.draftVersion,
})

/**
 * Brings a session that fell out of step with the server back into it
 * (ADR-021, amendment of 2026-10-11): takes a lapsed lock again, waits for
 * somebody else's to free, and merges this author's unsent changes with
 * whatever the server's draft became meanwhile.
 *
 * - Nobody else wrote (theirs is the base): the edit is saved as it is.
 * - Somebody wrote: the two are merged against the base the recovery store
 *   kept. A clean merge goes into the editor and is saved; a conflicted one
 *   waits in `conflicted` for the author, block by block.
 * - Somebody holds the lock: nothing is lost, and the lock is asked for again
 *   until it frees; then the merge runs.
 *
 * Typing never waits on any of it: the merge reads the edit the editor has
 * already handed autosave, and runs again if more arrived while it ran.
 */
export function useDraftReconciliation(
  options: UseDraftReconciliationOptions,
): DraftReconciliation {
  const { lock, autosave, client, store } = options
  const clock = options.clock ?? systemClock
  const waitIntervalMs = options.waitIntervalMs ?? HEARTBEAT_INTERVAL_MS
  const [merge] = useState<MergeRunner>(() => options.merge ?? mergeOnThisThread)

  const [phase, setPhase] = useState<ReconcilePhase>(IDLE)
  const phaseRef = useRef(phase)
  const apply = useCallback((event: ReconcileEvent) => {
    // An event that changes nothing returns the same phase, which React
    // does not render for.
    const next = reconcileReducer(phaseRef.current, event)
    phaseRef.current = next
    setPhase(next)
  }, [])

  const latest = useRef(options)
  // Mirrors the latest options into a ref for the async paths below — the
  // server's answers and the clock's timers, the external systems they wait
  // on — which act on the session as it is when they resume, not as it was
  // when they started.
  useEffect(() => {
    latest.current = options
  })

  const need = reconcileNeed(lock.status, autosave.status, autosave.unsaved)
  const { holder } = lock

  /** The edit, merged or not, goes on top of the server's draft and is saved. */
  const settle = useCallback(
    (ast: DocumentAst | undefined, theirs: LoadedDraft, merged: boolean) => {
      const current = latest.current
      if (merged && ast !== undefined) current.onReplace(ast)
      current.autosave.adopt(ast, baseOf(theirs), merged ? { merged: true } : undefined)
      if (merged) current.onMerged(theirs)
      apply({ type: 'settled' })
    },
    [apply],
  )

  const runMerge = useCallback(async (): Promise<void> => {
    apply({ type: 'merge-started' })
    for (let pass = 1; ; pass += 1) {
      latest.current.autosave.buffer()
      const mine = store.read()
      let theirs: LoadedDraft
      try {
        theirs = await client.load()
      } catch (error) {
        apply({
          type: 'failed',
          reason: error instanceof Error ? error.message : 'The draft could not be read',
        })
        return
      }
      const base = store.readBase()
      if (mine === undefined) {
        // Nothing of ours to keep: carry on from theirs.
        latest.current.onReplace(theirs.ast)
        settle(undefined, theirs, false)
        return
      }
      if (base !== undefined && contentKey(base.ast) === contentKey(theirs.ast)) {
        // Nobody else changed anything: ours goes on top as it is.
        settle(mine.ast, theirs, false)
        return
      }
      // A recovered edit from before bases were kept has no common ancestor:
      // merged against an empty one, everything both sides hold is kept or offered.
      const result = await merge(base?.ast ?? EMPTY_DOCUMENT, mine.ast, theirs.ast)
      latest.current.autosave.buffer()
      if (store.read() !== mine && pass < MERGE_PASSES) continue
      if (result.conflicts.length === 0) settle(result.merged, theirs, true)
      else apply({ type: 'conflicted', merge: result, theirs, mine: mine.ast })
      return
    }
  }, [apply, client, merge, settle, store])

  const relockedAt = useRef<number | null | undefined>(undefined)
  const { lastSavedAt } = autosave
  // Takes a lapsed lock again on the server, the external system this hook
  // keeps the session in step with. Once per stretch without a save, so a
  // server that keeps refusing is left to the author rather than hammered.
  useEffect(() => {
    if (need !== 'relock' || relockedAt.current === lastSavedAt) return
    relockedAt.current = lastSavedAt
    apply({ type: 'relock-started' })
    void latest.current.lock.acquire().then(() => {
      latest.current.autosave.retry()
      apply({ type: 'settled' })
    })
  }, [apply, lastSavedAt, need])

  // Asks for a lock somebody else holds on `clock`, until it frees; then
  // autosave resumes, and a save over a draft that moved on comes back as a
  // conflict, which is merged.
  useEffect(() => {
    if (need !== 'wait') return undefined
    apply({ type: 'waiting', holder })
    let cancelled = false
    let handle = 0
    const ask = (): void => {
      void latest.current.lock.reacquire().then(() => {
        latest.current.autosave.retry()
        if (!cancelled) handle = clock.setTimeout(ask, waitIntervalMs)
      })
    }
    handle = clock.setTimeout(ask, waitIntervalMs)
    return () => {
      cancelled = true
      clock.clearTimeout(handle)
      apply({ type: 'settled' })
    }
  }, [apply, clock, holder, need, waitIntervalMs])

  // Reads the server's draft and merges when ours turned out to be behind it.
  useEffect(() => {
    if (need !== 'merge' || phaseRef.current.status !== 'idle') return
    void runMerge()
  }, [need, runMerge])

  // Keyed on the failure itself, so every failure schedules its own retry.
  const failure = phase.status === 'failed' ? phase : undefined
  // Reads the server's draft again on `clock` after a read that failed: the
  // network and the timer are the external systems this waits on.
  useEffect(() => {
    if (failure === undefined) return undefined
    const handle = clock.setTimeout(() => {
      void runMerge()
    }, RECONCILE_RETRY_MS)
    return () => {
      clock.clearTimeout(handle)
    }
  }, [clock, failure, runMerge])

  const resolve = (resolutions: readonly ConflictResolution[]): void => {
    const current = phaseRef.current
    if (current.status !== 'conflicted') return
    const resolved = resolveMerge(current.merge, resolutions)
    if (resolved !== undefined) settle(resolved, current.theirs, true)
  }

  const keepMine = (): void => {
    const current = phaseRef.current
    if (current.status !== 'conflicted') return
    settle(current.mine, current.theirs, false)
  }

  return { phase, resolve, keepMine }
}
