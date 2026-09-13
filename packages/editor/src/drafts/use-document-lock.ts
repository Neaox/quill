import { useCallback, useEffect, useRef, useState } from 'react'
import type { Clock } from './clock.ts'
import { systemClock } from './clock.ts'
import type { LockClient } from './clients.ts'
import type { LockEvent, LockState, LockStatus } from './lock-machine.ts'
import { initialLockState, lockReducer } from './lock-machine.ts'

/** ADR-021: heartbeat every 15 seconds against a 60 second expiry. */
export const HEARTBEAT_INTERVAL_MS = 15_000

/**
 * R5 section 4: a heartbeat that failed to complete is retried immediately rather
 * than at the next scheduled tick, so the blind-editing window is one round trip
 * rather than a whole interval.
 */
export const HEARTBEAT_RETRY_DELAY_MS = 0

export interface UseDocumentLockOptions {
  readonly client: LockClient
  readonly clock?: Clock
  /** ADR-021: 15 seconds. */
  readonly heartbeatIntervalMs?: number
  /** A failed heartbeat is retried immediately rather than at the next tick (R5 section 4). */
  readonly retryDelayMs?: number
  /** Set false for a reader: no heartbeats are scheduled and no lock is kept alive. */
  readonly enabled?: boolean
}

export interface DocumentLock extends LockState {
  acquire(): Promise<void>
  takeover(): Promise<void>
  release(): Promise<void>
}

/** The statuses in which we still believe we have something worth heartbeating. */
const BEATING_STATUSES: ReadonlySet<LockStatus> = new Set(['held', 'reconnecting', 'at_risk'])

/** The one scheduled heartbeat, shared between the effect and the dispatcher. */
interface HeartbeatTimer {
  handle: number | undefined
}

/**
 * Drives `lockReducer` against a `LockClient`. All of the policy lives in the
 * reducer; this hook only owns the timers, which is the one external system it
 * synchronises with.
 */
export function useDocumentLock(options: UseDocumentLockOptions): DocumentLock {
  const { client } = options
  const clock = options.clock ?? systemClock
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
  const retryDelayMs = options.retryDelayMs ?? HEARTBEAT_RETRY_DELAY_MS
  const enabled = options.enabled ?? true

  const [state, setState] = useState<LockState>(initialLockState)
  // The reducer output is mirrored in a ref so the effect's cleanup can ask what we
  // hold without having to re-run, and therefore re-schedule, on every transition.
  const stateRef = useRef<LockState>(initialLockState)
  const timerRef = useRef<HeartbeatTimer>({ handle: undefined })
  const mountedRef = useRef(true)
  const startHeartbeatRef = useRef<(() => void) | null>(null)

  const apply = useCallback(
    (event: LockEvent) => {
      if (!mountedRef.current) return
      const next = lockReducer(stateRef.current, event)
      if (next === stateRef.current) return
      stateRef.current = next

      const timer = timerRef.current
      // Leaving a heartbeatable state stops the loop at once: a beat already on the
      // clock would otherwise fire one pointless request against a lock we lost.
      if (!BEATING_STATUSES.has(next.status) && timer.handle !== undefined) {
        clock.clearTimeout(timer.handle)
        timer.handle = undefined
      }

      setState(next)
    },
    [clock],
  )

  // Owns the heartbeat timer against the LockClient: schedules retries with
  // `clock.setTimeout` and calls `client.heartbeat()` over the network, the one
  // external system this hook synchronises with.
  useEffect(() => {
    mountedRef.current = true
    const timer = timerRef.current
    let cancelled = false

    const beat = () => {
      timer.handle = undefined
      client.heartbeat().then(
        (result) => {
          if (cancelled) return
          apply({ type: 'heartbeat-result', result })
          // Only a heartbeat that actually succeeded keeps the loop going; every
          // other outcome has already moved the machine out of a beating state.
          if (result.status === 'alive') schedule(heartbeatIntervalMs)
        },
        () => {
          if (cancelled) return
          apply({ type: 'heartbeat-failed' })
          schedule(retryDelayMs)
        },
      )
    }

    function schedule(delayMs: number): void {
      if (!BEATING_STATUSES.has(stateRef.current.status)) return
      timer.handle = clock.setTimeout(beat, delayMs)
    }

    startHeartbeatRef.current = enabled ? () => schedule(heartbeatIntervalMs) : null

    return () => {
      mountedRef.current = false
      cancelled = true
      startHeartbeatRef.current = null
      if (timer.handle !== undefined) {
        clock.clearTimeout(timer.handle)
        timer.handle = undefined
      }
      // Leaving with the lock still held would block the document for up to 60s.
      if (stateRef.current.lock !== null) void client.release()
    }
  }, [apply, clock, client, enabled, heartbeatIntervalMs, retryDelayMs])

  const acquire = async (): Promise<void> => {
    apply({ type: 'acquire-started' })
    const result = await client.acquire()
    apply({ type: 'acquire-result', result })
    startHeartbeatRef.current?.()
  }

  const takeover = async (): Promise<void> => {
    const result = await client.takeover()
    apply({ type: 'takeover-result', result })
    startHeartbeatRef.current?.()
  }

  const release = async (): Promise<void> => {
    await client.release()
    apply({ type: 'released' })
  }

  return { ...state, acquire, takeover, release }
}
