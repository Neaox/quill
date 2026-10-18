import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackoffPolicy } from './backoff.ts'
import { backoffDelay } from './backoff.ts'
import type { Clock } from './clock.ts'
import { systemClock } from './clock.ts'
import type { LockClient } from './clients.ts'
import type { Connectivity } from './connectivity.ts'
import { browserConnectivity } from './connectivity.ts'
import type { LockEvent, LockState, LockStatus } from './lock-machine.ts'
import { initialLockState, lockReducer } from './lock-machine.ts'

/** ADR-021: heartbeat every 15 seconds against a 60 second expiry. */
export const HEARTBEAT_INTERVAL_MS = 15_000

/**
 * R5 section 4: a heartbeat that failed to complete is retried immediately rather
 * than at the next scheduled tick, so the blind-editing window is one round trip
 * rather than a whole interval. Every retry after that backs off with jitter, to
 * a cap well inside the 60 second expiry so a lapse still gets several attempts:
 * a retry with no delay at all sent 296 requests from one tab in a 40 second
 * outage (audit 2026-10-11, P0-4).
 */
export const HEARTBEAT_RETRY_BACKOFF: Pick<BackoffPolicy, 'baseMs' | 'capMs'> = {
  baseMs: 1000,
  capMs: 10_000,
}

export interface UseDocumentLockOptions {
  readonly client: LockClient
  readonly clock?: Clock
  /** ADR-021: 15 seconds. */
  readonly heartbeatIntervalMs?: number
  /** After the immediate first retry (R5 section 4), how later retries back off. */
  readonly retryBackoff?: Pick<BackoffPolicy, 'baseMs' | 'capMs'>
  /** `Math.random` unless a test pins the jitter. Read once, on mount. */
  readonly random?: () => number
  /** Retries pause while offline or hidden, and go at once when that ends. */
  readonly connectivity?: Connectivity
  /** Set false for a reader: no heartbeats are scheduled and no lock is kept alive. */
  readonly enabled?: boolean
}

export interface DocumentLock extends LockState {
  acquire(): Promise<void>
  /**
   * Asks for the lock once more, quietly: what the author sees does not
   * change until the answer does, and a failed request is simply not an
   * answer. For waiting while somebody else edits (ADR-021, amendment of
   * 2026-10-11), where the next ask is never far off.
   */
  reacquire(): Promise<void>
  takeover(): Promise<void>
  release(): Promise<void>
}

/** The statuses in which we still believe we have something worth heartbeating. */
const BEATING_STATUSES: ReadonlySet<LockStatus> = new Set(['held', 'reconnecting', 'at_risk'])

/** The statuses in which the last heartbeat failed and the next one is a retry. */
const RETRYING_STATUSES: ReadonlySet<LockStatus> = new Set(['reconnecting', 'at_risk'])

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
  // Primitives, so a caller passing a fresh object each render does not
  // restart the loop (and release the lock) every time it renders.
  const { baseMs, capMs } = options.retryBackoff ?? HEARTBEAT_RETRY_BACKOFF
  // Read once, for the same reason.
  const [random] = useState(() => options.random ?? Math.random)
  const connectivity = options.connectivity ?? browserConnectivity
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
  // `clock.setTimeout`, calls `client.heartbeat()` over the network, and listens
  // to the browser's online and visibility events — the external systems this
  // hook synchronises with.
  useEffect(() => {
    mountedRef.current = true
    const timer = timerRef.current
    let cancelled = false
    let inFlight = false

    const clearTimer = () => {
      if (timer.handle === undefined) return
      clock.clearTimeout(timer.handle)
      timer.handle = undefined
    }

    const beat = () => {
      timer.handle = undefined
      inFlight = true
      client.heartbeat().then(
        (result) => {
          inFlight = false
          if (cancelled) return
          apply({ type: 'heartbeat-result', result })
          // Only a heartbeat that actually succeeded keeps the loop going; every
          // other outcome has already moved the machine out of a beating state.
          if (result.status === 'alive') schedule(heartbeatIntervalMs)
        },
        () => {
          inFlight = false
          if (cancelled) return
          apply({ type: 'heartbeat-failed' })
          scheduleRetry()
        },
      )
    }

    function schedule(delayMs: number): void {
      if (!BEATING_STATUSES.has(stateRef.current.status)) return
      timer.handle = clock.setTimeout(beat, delayMs)
    }

    const canReachServer = () => connectivity.isOnline() && connectivity.isVisible()

    /**
     * Immediately after the first miss, then backing off. Offline or hidden,
     * nothing is scheduled at all: the listener below resumes the loop. A
     * healthy lock keeps its 15 second cadence while hidden, because pausing
     * that would let the lock lapse whenever the author switched tabs.
     */
    function scheduleRetry(): void {
      if (!canReachServer()) return
      const misses = stateRef.current.missedHeartbeats
      schedule(misses <= 1 ? 0 : backoffDelay(misses - 1, { baseMs, capMs, random }))
    }

    const unsubscribe = connectivity.subscribe(() => {
      if (cancelled || !RETRYING_STATUSES.has(stateRef.current.status)) return
      clearTimer()
      if (canReachServer() && !inFlight) beat()
    })

    startHeartbeatRef.current = enabled ? () => schedule(heartbeatIntervalMs) : null

    return () => {
      mountedRef.current = false
      cancelled = true
      startHeartbeatRef.current = null
      unsubscribe()
      clearTimer()
      // Leaving with the lock still held would block the document for up to 60s.
      if (stateRef.current.lock !== null) void client.release()
    }
  }, [apply, baseMs, capMs, clock, client, connectivity, enabled, heartbeatIntervalMs, random])

  /**
   * One attempt at the lock. A request that failed (the server restarting as
   * the editor opens) is retried with the heartbeat's backoff rather than
   * rejected: a rejection left the lock "opening" for good, and autosave with
   * it, while the author typed into a buffer that was never sent.
   */
  const attemptAcquire = async (attempt: number): Promise<void> => {
    let result
    try {
      result = await client.acquire()
    } catch {
      if (!mountedRef.current || stateRef.current.status !== 'acquiring') return
      timerRef.current.handle = clock.setTimeout(
        () => {
          timerRef.current.handle = undefined
          void attemptAcquire(attempt + 1)
        },
        backoffDelay(attempt, { baseMs, capMs, random }),
      )
      return
    }
    apply({ type: 'acquire-result', result })
    startHeartbeatRef.current?.()
  }

  const acquire = async (): Promise<void> => {
    apply({ type: 'acquire-started' })
    await attemptAcquire(1)
  }

  const reacquire = async (): Promise<void> => {
    let result
    try {
      result = await client.acquire()
    } catch {
      return
    }
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

  return { ...state, acquire, reacquire, takeover, release }
}
