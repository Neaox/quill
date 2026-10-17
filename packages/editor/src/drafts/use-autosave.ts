import { isDeepEqual } from 'remeda'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  AutosaveEvent,
  AutosavePhase,
  AutosaveState,
  AutosaveStatus,
} from './autosave-machine.ts'
import { autosaveReducer, failuresSoFar, initialAutosaveState } from './autosave-machine.ts'
import { backoffDelay } from './backoff.ts'
import type { Clock } from './clock.ts'
import { systemClock } from './clock.ts'
import type { DocumentAst, DraftClient, DraftSaveResult, LockHolder } from './clients.ts'
import type { Connectivity } from './connectivity.ts'
import { browserConnectivity } from './connectivity.ts'
import type { DraftChannel } from './draft-channel.ts'
import type { DraftBase, PendingDraft, RecoveryStore } from './recovery-store.ts'

export type { AutosavePhase, AutosaveStatus }

/** ADR-021: edits are debounced, not sent per keystroke. */
export const AUTOSAVE_DEBOUNCE_MS = 1000

/** Transient failures back off from one second to half a minute (audit 2026-10-11, P0-1). */
export const AUTOSAVE_RETRY_BASE_MS = 1000
export const AUTOSAVE_RETRY_CAP_MS = 30_000

export interface UseAutosaveOptions {
  readonly client: DraftClient
  readonly store: RecoveryStore
  /**
   * The draft version the editor's content was loaded at. Read once, on mount:
   * a newer version becomes this tab's base only through its own save, through
   * `keepMine`, or by remounting with the reloaded content. Raising it from a
   * background refetch is exactly how a stale tab used to overwrite a newer
   * draft without being told (audit 2026-10-11, P0-5).
   */
  readonly documentVersion: number
  /**
   * The draft as loaded, which becomes the recovery store's base — the common
   * ancestor of any merge — when nothing unsent is waiting from a previous
   * session (ADR-021, amendment of 2026-10-11). An unsent edit keeps the base
   * it was written on.
   */
  readonly documentAst?: DocumentAst
  /** Wire the lock's `canAutosave` here. */
  readonly canSave: boolean
  readonly clock?: Clock
  readonly debounceMs?: number
  readonly connectivity?: Connectivity
  /** Other tabs of this browser editing the same document. */
  readonly channel?: DraftChannel
  /** `Math.random` unless a test pins the jitter. Read once, on mount. */
  readonly random?: () => number
}

export interface Autosave {
  readonly status: AutosaveStatus
  readonly phase: AutosavePhase
  readonly draftVersion: number
  readonly lastSavedAt: number | null
  readonly pending: PendingDraft | undefined
  /** Whether an edit has not reached the server yet, buffered or still waiting to be read. */
  readonly unsaved: boolean
  readonly holder: LockHolder | null
  /**
   * Queue an edit. Debounced; the entry is written to the recovery store
   * BEFORE any network call.
   *
   * The editor passes a way to read the tree rather than the tree (P0-6):
   * serialising a long document costs several frames, so a keystroke only
   * marks the draft dirty, and the tree is read once — when the save is about
   * to go, when it cannot go and has to be buffered, when the tab is hidden,
   * or when the session ends.
   */
  change(edit: DocumentAst | (() => DocumentAst)): void
  /** Send now (navigation, publishing), ignoring the debounce. Never sends over a known conflict. */
  flush(): Promise<void>
  /** Try again now after a failure, a lost lock that is back, or while waiting to retry. */
  retry(): void
  /** Resolve a conflict by saving this tab's edit on top of the newer draft, knowingly. */
  keepMine(): Promise<void>
  /**
   * Reads an edit still waiting as a thunk into the recovery store now, so a
   * caller about to take the buffer (a reload that sets it aside) gets all of it.
   */
  buffer(): void
  /**
   * Carries on from the server's draft `base`: with `ast` — a merge of this
   * session's edit into it, or the edit kept over it — to be saved on top of
   * it, or with nothing to send. Whatever had stopped autosave is settled.
   */
  adopt(ast: DocumentAst | undefined, base: DraftBase, note?: { readonly merged: boolean }): void
}

/**
 * A server stores the tree as JSON, which drops `undefined` fields and may
 * reorder keys; compare what the two would look like on the wire.
 */
function onTheWire(tree: DocumentAst): unknown {
  return JSON.parse(JSON.stringify(tree))
}

function sameTree(left: DocumentAst, right: DocumentAst): boolean {
  return isDeepEqual(onTheWire(left), onTheWire(right))
}

const MERGED = { merged: true } as const

async function attemptSave(client: DraftClient, entry: PendingDraft): Promise<DraftSaveResult> {
  try {
    return entry.merged === true
      ? await client.save(entry.ast, entry.expectedVersion, MERGED)
      : await client.save(entry.ast, entry.expectedVersion)
  } catch (error) {
    // The adapter maps every outcome it knows; anything thrown is a refusal
    // we cannot classify, which must still leave autosave able to go on.
    return {
      status: 'rejected',
      message: error instanceof Error ? error.message : 'The draft could not be saved',
    }
  }
}

/**
 * The autosave loop of ADR-021: buffer locally, debounce, write the draft,
 * and pop the buffer only on an acknowledgement. Every failure path keeps the
 * buffered edit, and every one of them has a way back (`autosave-machine.ts`).
 *
 * Writes are never duplicated: every save carries the version it was based
 * on, so a retry of a write the server already applied is refused as stale.
 * When that happens after a lost response, the draft is read back, and if it
 * is exactly the tree we sent, the write is adopted as ours rather than
 * reported as somebody else's.
 */
export function useAutosave(options: UseAutosaveOptions): Autosave {
  const { client, store, canSave, channel } = options
  const clock = options.clock ?? systemClock
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS
  const connectivity = options.connectivity ?? browserConnectivity
  // Read once, so a caller passing a fresh function each render does not
  // restart the timers every time it renders.
  const [random] = useState(() => options.random ?? Math.random)

  // An entry left over from a previous session is already pending: it never
  // reached the server, so mounting must pick it up rather than start clean.
  const [entry, setEntry] = useState<PendingDraft | undefined>(() => store.read())
  const [state, setState] = useState<AutosaveState>(() =>
    initialAutosaveState(options.documentVersion, store.read() !== undefined),
  )
  // Mirrored so the async save path reads the state as it is when the answer
  // arrives, not as it was when the request left.
  const stateRef = useRef(state)
  const inFlightRef = useRef(false)
  /** Sends whose answer never arrived; one of them may have been applied. */
  const unconfirmedRef = useRef<PendingDraft[]>([])
  /** The latest edit not yet read into a tree (see `change`). */
  const unreadRef = useRef<(() => DocumentAst) | undefined>(undefined)
  // The debounce runs from the last edit. Keystrokes move this rather than
  // rendering, so typing in a long document re-renders nothing.
  const [mountedAt] = useState(() => clock.now())
  const lastEditRef = useRef(mountedAt)

  // Read once, like `documentVersion`: the content this session opened on.
  const [openedOn] = useState<DraftBase | undefined>(() =>
    options.documentAst === undefined
      ? undefined
      : { ast: options.documentAst, draftVersion: options.documentVersion },
  )
  // Records the draft as loaded as the merge base in the recovery store (an
  // external system) when this session starts from it, before any edit.
  useEffect(() => {
    if (openedOn !== undefined && store.read() === undefined) store.writeBase(openedOn)
  }, [openedOn, store])

  const apply = useCallback((event: AutosaveEvent) => {
    const next = autosaveReducer(stateRef.current, event)
    if (next === stateRef.current) return
    stateRef.current = next
    setState(next)
  }, [])

  const replaceEntry = useCallback(
    (next: PendingDraft | undefined) => {
      if (next === undefined) store.clear()
      else store.write(next)
      setEntry(next)
    },
    [store],
  )

  /** Reads an edit still waiting as a thunk into the recovery buffer. */
  const bufferUnread = useCallback(() => {
    const read = unreadRef.current
    if (read === undefined) return
    unreadRef.current = undefined
    replaceEntry(pendingOf(read(), stateRef.current.draftVersion, clock.now(), store.read()))
  }, [clock, replaceEntry, store])

  /** The server has `sent` at `draftVersion`. A newer edit is moved onto that base. */
  const acknowledge = useCallback(
    (sent: PendingDraft, draftVersion: number, savedAt: number) => {
      unconfirmedRef.current = []
      // What the server now holds is what both sides agree on: the next merge's base.
      store.writeBase({ ast: sent.ast, draftVersion })
      const current = store.read()
      const newer = current !== undefined && current !== sent
      replaceEntry(
        newer ? pendingOf(current.ast, draftVersion, current.savedAt, undefined) : undefined,
      )
      const more = newer || unreadRef.current !== undefined
      apply({ type: 'saved', draftVersion, savedAt, more })
      channel?.publish({ draftVersion })
    },
    [apply, channel, replaceEntry, store],
  )

  const retryLater = useCallback(
    (retryAfterMs: number | null) => {
      const attempt = failuresSoFar(stateRef.current) + 1
      const delay = backoffDelay(attempt, {
        baseMs: AUTOSAVE_RETRY_BASE_MS,
        capMs: AUTOSAVE_RETRY_CAP_MS,
        random,
        retryAfterMs,
      })
      apply({
        type: 'unavailable',
        attempt,
        nextAt: clock.now() + delay,
        online: connectivity.isOnline(),
      })
    },
    [apply, clock, connectivity, random],
  )

  /** A 409 after a lost response may be our own write; read the draft back and see. */
  const settleStale = useCallback(
    async (currentVersion: number) => {
      const candidates = unconfirmedRef.current
      if (candidates.length === 0) {
        apply({ type: 'stale', currentVersion })
        return
      }
      let loaded
      try {
        loaded = await client.load()
      } catch {
        retryLater(null)
        return
      }
      const ours = candidates.find(
        (sent) =>
          loaded.draftVersion === sent.expectedVersion + 1 && sameTree(loaded.ast, sent.ast),
      )
      if (ours === undefined) {
        unconfirmedRef.current = []
        apply({ type: 'stale', currentVersion: loaded.draftVersion })
        return
      }
      acknowledge(ours, loaded.draftVersion, clock.now())
    },
    [acknowledge, apply, client, clock, retryLater],
  )

  /** What the answer to one send means for the loop. */
  const settle = useCallback(
    async (queued: PendingDraft, result: DraftSaveResult): Promise<void> => {
      switch (result.status) {
        case 'saved':
          acknowledge(queued, result.draftVersion, result.updatedAt)
          return
        case 'unavailable':
          unconfirmedRef.current = [...unconfirmedRef.current, queued]
          retryLater(result.retryAfterMs)
          return
        case 'stale_version':
          await settleStale(result.currentVersion)
          return
        case 'rejected':
          apply({ type: 'failed', reason: result.message })
          return
        case 'lock_lost':
          apply({ type: 'lock-lost', holder: result.holder })
          return
        case 'session_expired':
          apply({ type: 'session-expired' })
          return
      }
    },
    [acknowledge, apply, retryLater, settleStale],
  )

  const send = useCallback(async (): Promise<void> => {
    bufferUnread()
    if (!canSave || inFlightRef.current) return
    if (stateRef.current.phase.status === 'conflict') return
    const queued = store.read()
    if (queued === undefined) return

    inFlightRef.current = true
    apply({ type: 'save-started' })
    await attemptSave(client, queued)
      .then((result) => settle(queued, result))
      .finally(() => {
        // Whatever happened, the loop is free again: this is the line whose
        // absence froze autosave on "saving" for good.
        inFlightRef.current = false
      })
  }, [apply, bufferUnread, canSave, client, settle, store])

  // Times the next send against `clock` — the debounce after the last edit,
  // or the backoff after a transient failure — and then writes to the
  // DraftClient, the external system this effect synchronises with (ADR-021).
  useEffect(() => {
    if (!canSave || (entry === undefined && unreadRef.current === undefined)) return undefined
    const { phase } = state
    const quietFor = () => lastEditRef.current + debounceMs - clock.now()
    let delay: number
    if (phase.status === 'dirty') delay = Math.max(0, quietFor())
    else if (phase.status === 'retrying') delay = Math.max(0, phase.nextAt - clock.now())
    else return undefined
    let handle: number
    const due = () => {
      // Keystrokes since this was scheduled moved the debounce on.
      if (phase.status === 'dirty' && quietFor() > 0) {
        handle = clock.setTimeout(due, quietFor())
        return
      }
      void send()
    }
    handle = clock.setTimeout(due, delay)
    return () => {
      clock.clearTimeout(handle)
    }
  }, [canSave, clock, debounceMs, entry, send, state])

  /**
   * Reads an unread edit into the recovery buffer once typing pauses for the
   * debounce, whatever the session is doing: in flight, offline, retrying or
   * without the lock, a crash must still leave the edit in this browser. The
   * timer is started by the keystroke rather than by a render, which is what
   * keeps typing from rendering anything.
   */
  const bufferTimerRef = useRef<number | undefined>(undefined)
  const bufferWhenQuiet = (): void => {
    if (bufferTimerRef.current !== undefined) return
    const due = (): void => {
      const quietFor = lastEditRef.current + debounceMs - clock.now()
      if (quietFor > 0) {
        bufferTimerRef.current = clock.setTimeout(due, quietFor)
        return
      }
      bufferTimerRef.current = undefined
      bufferUnread()
    }
    bufferTimerRef.current = clock.setTimeout(due, debounceMs)
  }

  // Stops that timer and buffers an edit still unread when the session ends,
  // into the recovery store (the external system), so leaving within the
  // debounce loses nothing.
  useEffect(
    () => () => {
      if (bufferTimerRef.current !== undefined) clock.clearTimeout(bufferTimerRef.current)
      bufferTimerRef.current = undefined
      bufferUnread()
    },
    [bufferUnread, clock],
  )

  // Subscribes to the browser's online and visibility events: going offline
  // says so honestly, coming back retries at once instead of waiting out the
  // backoff, and a hidden tab — which may never be shown again — buffers the
  // unread edit now.
  useEffect(
    () =>
      connectivity.subscribe(() => {
        if (!connectivity.isVisible()) bufferUnread()
        if (!connectivity.isOnline()) apply({ type: 'went-offline' })
        else if (connectivity.isVisible()) apply({ type: 'connectivity-back', now: clock.now() })
      }),
    [apply, bufferUnread, clock, connectivity],
  )

  // Listens to the other tabs of this browser (`draft-channel.ts`): a newer
  // version saved there makes this tab's base stale before it types.
  useEffect(
    () => channel?.subscribe(({ draftVersion }) => apply({ type: 'remote-saved', draftVersion })),
    [apply, channel],
  )

  const change = (edit: DocumentAst | (() => DocumentAst)): void => {
    lastEditRef.current = clock.now()
    if (typeof edit === 'function') {
      unreadRef.current = edit
      bufferWhenQuiet()
    } else {
      unreadRef.current = undefined
      // Buffer first: a crash between here and the response must still be recoverable.
      replaceEntry(pendingOf(edit, stateRef.current.draftVersion, clock.now(), store.read()))
    }
    // Already dirty, there is nothing to tell: the debounce reads `lastEditRef`.
    if (stateRef.current.phase.status !== 'dirty') apply({ type: 'edited' })
  }

  const retry = (): void => {
    bufferUnread()
    apply({ type: 'retry-now', now: clock.now(), pending: store.read() !== undefined })
  }

  const keepMine = async (): Promise<void> => {
    const { phase, draftVersion } = stateRef.current
    if (phase.status !== 'conflict') return
    let base = phase.currentVersion
    // A 409 that could not say which version won reports 0; read it back.
    if (base <= draftVersion) {
      try {
        base = (await client.load()).draftVersion
      } catch {
        return
      }
    }
    bufferUnread()
    const current = store.read()
    if (current !== undefined) replaceEntry({ ...current, expectedVersion: base })
    apply({ type: 'rebased', draftVersion: base, pending: current !== undefined })
  }

  const adopt = (
    ast: DocumentAst | undefined,
    base: DraftBase,
    note?: { readonly merged: boolean },
  ): void => {
    // The adopted tree supersedes anything typed into the old one.
    unreadRef.current = undefined
    unconfirmedRef.current = []
    store.writeBase(base)
    replaceEntry(
      ast === undefined
        ? undefined
        : {
            ast,
            expectedVersion: base.draftVersion,
            savedAt: clock.now(),
            ...(note?.merged === true ? MERGED : {}),
          },
    )
    apply({ type: 'merged', draftVersion: base.draftVersion, pending: ast !== undefined })
  }

  const { phase } = state
  return {
    status: phase.status,
    phase,
    draftVersion: state.draftVersion,
    lastSavedAt: state.lastSavedAt,
    pending: entry,
    unsaved: entry !== undefined || phase.status === 'dirty',
    holder: phase.status === 'blocked' ? phase.holder : null,
    change,
    flush: send,
    retry,
    keepMine,
    buffer: bufferUnread,
    adopt,
  }
}

/**
 * A new unsent edit. One that is still the merge it replaces says so, until
 * the merge is acknowledged: the edits typed after a merge go out with it.
 */
function pendingOf(
  ast: DocumentAst,
  expectedVersion: number,
  savedAt: number,
  previous: PendingDraft | undefined,
): PendingDraft {
  return previous?.merged === true
    ? { ast, expectedVersion, savedAt, merged: true }
    : { ast, expectedVersion, savedAt }
}
