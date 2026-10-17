import type { LockHolder } from './clients.ts'

/**
 * Autosave as a pure state machine (audit 2026-10-11, P0-1). Every state an
 * author can be in is named, and every one of them has a way out: the bug this
 * replaces was a `saving` flag that a thrown request left set for ever.
 *
 * - `dirty`: an edit is buffered and waits for the debounce.
 * - `saving`: one request is out; edits made meanwhile coalesce into the next.
 * - `retrying` / `offline`: the server or the network failed transiently; the
 *   buffered edit is resent at `nextAt`, or as soon as the browser is back.
 * - `conflict`: the draft moved on somewhere else (409, or another tab said so).
 *   Nothing is sent until the author reloads or keeps theirs.
 * - `blocked` / `signed_out`: the lock or the session is gone (R5).
 * - `failed`: the server refused for good; the author can retry, and the next
 *   edit tries again by itself.
 */
export type AutosavePhase =
  | { readonly status: 'idle' }
  | { readonly status: 'dirty' }
  | { readonly status: 'saving'; readonly attempt: number }
  | { readonly status: 'saved' }
  | { readonly status: 'retrying'; readonly attempt: number; readonly nextAt: number }
  | { readonly status: 'offline'; readonly attempt: number }
  | { readonly status: 'conflict'; readonly currentVersion: number }
  | { readonly status: 'blocked'; readonly holder: LockHolder | null }
  | { readonly status: 'signed_out' }
  | { readonly status: 'failed'; readonly reason: string }

export type AutosaveStatus = AutosavePhase['status']

export interface AutosaveState {
  readonly phase: AutosavePhase
  /** The draft version this tab's edits are based on: its own last acknowledgement, or a version it chose to adopt. */
  readonly draftVersion: number
  readonly lastSavedAt: number | null
}

export type AutosaveEvent =
  | { readonly type: 'edited' }
  | { readonly type: 'save-started' }
  /** `more`: an edit arrived while the request was out, and is still to send. */
  | {
      readonly type: 'saved'
      readonly draftVersion: number
      readonly savedAt: number
      readonly more: boolean
    }
  | {
      readonly type: 'unavailable'
      readonly attempt: number
      readonly nextAt: number
      readonly online: boolean
    }
  | { readonly type: 'failed'; readonly reason: string }
  | { readonly type: 'stale'; readonly currentVersion: number }
  | { readonly type: 'lock-lost'; readonly holder: LockHolder | null }
  | { readonly type: 'session-expired' }
  | { readonly type: 'remote-saved'; readonly draftVersion: number }
  | { readonly type: 'went-offline' }
  /** The network came back or the tab came into view: a waiting retry goes now. */
  | { readonly type: 'connectivity-back'; readonly now: number }
  /** The author pressed Retry, or took back the lock. */
  | { readonly type: 'retry-now'; readonly now: number; readonly pending: boolean }
  /** The author chose to keep their edit on top of `draftVersion`. */
  | { readonly type: 'rebased'; readonly draftVersion: number; readonly pending: boolean }
  /**
   * The edit was merged with the server's draft at `draftVersion`, or that
   * draft was adopted (ADR-021, amendment of 2026-10-11). Whatever stopped
   * autosave is settled by it: the edit now builds on what the server has.
   */
  | { readonly type: 'merged'; readonly draftVersion: number; readonly pending: boolean }

export function initialAutosaveState(draftVersion: number, pending: boolean): AutosaveState {
  return {
    phase: pending ? { status: 'dirty' } : { status: 'idle' },
    draftVersion,
    lastSavedAt: null,
  }
}

/** How many sends in a row have failed transiently. */
export function failuresSoFar(state: AutosaveState): number {
  const { phase } = state
  return phase.status === 'saving' || phase.status === 'retrying' || phase.status === 'offline'
    ? phase.attempt
    : 0
}

const DIRTY: AutosavePhase = { status: 'dirty' }

function withPhase(state: AutosaveState, phase: AutosavePhase): AutosaveState {
  return { ...state, phase }
}

/** The statuses in which a newer version elsewhere is news worth stopping for. */
const HEARS_REMOTE_SAVES: ReadonlySet<AutosaveStatus> = new Set([
  'idle',
  'dirty',
  'saved',
  'retrying',
  'offline',
  'failed',
  'conflict',
])

export function autosaveReducer(state: AutosaveState, event: AutosaveEvent): AutosaveState {
  const { phase } = state
  switch (event.type) {
    case 'edited':
      // In flight, retrying or offline, the next send already carries the
      // latest buffer; stopped states stay stopped until the author acts.
      return phase.status === 'idle' ||
        phase.status === 'saved' ||
        phase.status === 'failed' ||
        phase.status === 'dirty'
        ? withPhase(state, DIRTY)
        : state

    case 'save-started':
      return withPhase(state, { status: 'saving', attempt: failuresSoFar(state) })

    case 'saved':
      return {
        phase: event.more ? DIRTY : { status: 'saved' },
        draftVersion: event.draftVersion,
        lastSavedAt: event.savedAt,
      }

    case 'unavailable':
      return withPhase(
        state,
        event.online
          ? { status: 'retrying', attempt: event.attempt, nextAt: event.nextAt }
          : { status: 'offline', attempt: event.attempt },
      )

    case 'failed':
      return withPhase(state, { status: 'failed', reason: event.reason })

    case 'stale':
      return withPhase(state, { status: 'conflict', currentVersion: event.currentVersion })

    case 'lock-lost':
      return withPhase(state, { status: 'blocked', holder: event.holder })

    case 'session-expired':
      return withPhase(state, { status: 'signed_out' })

    case 'remote-saved':
      if (event.draftVersion <= state.draftVersion || !HEARS_REMOTE_SAVES.has(phase.status)) {
        return state
      }
      return withPhase(state, { status: 'conflict', currentVersion: event.draftVersion })

    case 'went-offline':
      return phase.status === 'dirty' || phase.status === 'retrying'
        ? withPhase(state, { status: 'offline', attempt: failuresSoFar(state) })
        : state

    case 'connectivity-back':
      return phase.status === 'retrying' || phase.status === 'offline'
        ? withPhase(state, { status: 'retrying', attempt: phase.attempt, nextAt: event.now })
        : state

    case 'retry-now':
      switch (phase.status) {
        case 'retrying':
        case 'offline':
          return withPhase(state, { status: 'retrying', attempt: phase.attempt, nextAt: event.now })
        case 'failed':
          return withPhase(state, { status: 'retrying', attempt: 0, nextAt: event.now })
        case 'blocked':
          return withPhase(state, event.pending ? DIRTY : { status: 'idle' })
        default:
          return state
      }

    case 'merged':
      return {
        ...state,
        phase: event.pending ? DIRTY : { status: 'idle' },
        draftVersion: event.draftVersion,
      }

    case 'rebased':
      return phase.status === 'conflict'
        ? {
            ...state,
            phase: event.pending ? DIRTY : { status: 'idle' },
            draftVersion: event.draftVersion,
          }
        : state
  }
}
