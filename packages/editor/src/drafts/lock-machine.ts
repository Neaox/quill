import type { AcquireResult, HeartbeatResult, Lock, LockHolder, TakeoverResult } from './clients.ts'

/**
 * `reconnecting` and `at_risk` are the two escalation steps R5 section 4 asks for
 * after one and two missed heartbeats; the client is still editing but is no longer
 * confident it holds the lock.
 */
export type LockStatus =
  | 'idle'
  | 'acquiring'
  | 'held'
  | 'reconnecting'
  | 'at_risk'
  | 'lost'
  | 'held_by_other'
  | 'released'

export interface LockState {
  readonly status: LockStatus
  readonly lock: Lock | null
  readonly holder: LockHolder | null
  readonly missedHeartbeats: number
  /** ADR-021: autosave runs only while the client is confident it holds a valid lock. */
  readonly canAutosave: boolean
}

/**
 * Everything that can move the lock. `heartbeat-failed` is the transport failure —
 * a timeout or a network error — which R5 section 4 says must be treated exactly
 * like an explicit `expired`/`taken_over` for UI purposes: uncertain is not fine.
 */
export type LockEvent =
  | { readonly type: 'acquire-started' }
  | { readonly type: 'acquire-result'; readonly result: AcquireResult }
  | { readonly type: 'heartbeat-result'; readonly result: HeartbeatResult }
  | { readonly type: 'heartbeat-failed' }
  | { readonly type: 'takeover-result'; readonly result: TakeoverResult }
  | { readonly type: 'released' }

export const initialLockState: LockState = {
  status: 'idle',
  lock: null,
  holder: null,
  missedHeartbeats: 0,
  canAutosave: false,
}

const LOST_STATE: LockState = { ...initialLockState, status: 'lost' }
const RELEASED_STATE: LockState = { ...initialLockState, status: 'released' }
const ACQUIRING_STATE: LockState = { ...initialLockState, status: 'acquiring' }

/** The only state that permits autosave, and the only way back into it. */
function holding(lock: Lock): LockState {
  return { status: 'held', lock, holder: null, missedHeartbeats: 0, canAutosave: true }
}

function heldByOther(holder: LockHolder): LockState {
  return { status: 'held_by_other', lock: null, holder, missedHeartbeats: 0, canAutosave: false }
}

function applyHeartbeat(lock: Lock, result: HeartbeatResult): LockState {
  switch (result.status) {
    case 'alive':
      return holding({ ...lock, expiresAt: result.expiresAt })
    case 'expired':
      return LOST_STATE
    case 'taken_over':
      return heldByOther(result.holder)
    case 'released':
      return RELEASED_STATE
  }
}

function missHeartbeat(state: LockState, lock: Lock): LockState {
  const missedHeartbeats = state.missedHeartbeats + 1
  return {
    // One miss is roughly 15s of silence, two is roughly 30s: warn before the 60s cutoff.
    status: missedHeartbeats > 1 ? 'at_risk' : 'reconnecting',
    lock,
    holder: null,
    missedHeartbeats,
    canAutosave: false,
  }
}

/**
 * The whole of the client locking policy, as a pure function. Nothing here reads a
 * clock or a network: reaching `held` again always takes a successful acquire,
 * takeover, or heartbeat, never the passage of time.
 */
export function lockReducer(state: LockState, event: LockEvent): LockState {
  switch (event.type) {
    case 'acquire-started':
      return ACQUIRING_STATE

    case 'acquire-result':
      return event.result.status === 'acquired'
        ? holding(event.result.lock)
        : heldByOther(event.result.holder)

    case 'takeover-result':
      // A refused takeover changes nothing: we are still wherever we already were.
      return event.result.status === 'acquired' ? holding(event.result.lock) : state

    case 'heartbeat-result':
      // A heartbeat that resolves after the lock has already gone is a stale reply
      // from before the release or loss, and must not resurrect anything.
      return state.lock === null ? state : applyHeartbeat(state.lock, event.result)

    case 'heartbeat-failed':
      return state.lock === null ? state : missHeartbeat(state, state.lock)

    case 'released':
      return RELEASED_STATE
  }
}
