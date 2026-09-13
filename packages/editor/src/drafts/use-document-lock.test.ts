import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FakeClock } from './clock.ts'
import { createFakeClock } from './clock.ts'
import type {
  AcquireResult,
  HeartbeatResult,
  Lock,
  LockClient,
  LockHolder,
  TakeoverResult,
} from './clients.ts'
import { useDocumentLock } from './use-document-lock.ts'

const lock: Lock = { holderUserId: 'u1', holderSessionId: 's1', expiresAt: 60_000 }
const holder: LockHolder = { userId: 'u2', displayName: 'Priya', expiresAt: 120_000 }

/** A heartbeat that never completes: the transport failure R5 section 4 is about. */
const PARTITIONED = 'partitioned'

interface FakeLockClient {
  readonly client: LockClient
  readonly calls: { acquire: number; heartbeat: number; release: number; takeover: number }
  answerAcquire(result: AcquireResult): void
  answerHeartbeat(result: HeartbeatResult | typeof PARTITIONED): void
  answerTakeover(result: TakeoverResult): void
}

function createFakeLockClient(): FakeLockClient {
  const calls = { acquire: 0, heartbeat: 0, release: 0, takeover: 0 }
  let acquireResult: AcquireResult = { status: 'acquired', lock }
  let heartbeatResult: HeartbeatResult | typeof PARTITIONED = {
    status: 'alive',
    expiresAt: 120_000,
  }
  let takeoverResult: TakeoverResult = { status: 'acquired', lock }

  return {
    calls,
    client: {
      acquire: async () => {
        calls.acquire += 1
        return acquireResult
      },
      heartbeat: async () => {
        calls.heartbeat += 1
        if (heartbeatResult === PARTITIONED) throw new Error('network unreachable')
        return heartbeatResult
      },
      release: async () => {
        calls.release += 1
      },
      takeover: async () => {
        calls.takeover += 1
        return takeoverResult
      },
    },
    answerAcquire: (result) => {
      acquireResult = result
    },
    answerHeartbeat: (result) => {
      heartbeatResult = result
    },
    answerTakeover: (result) => {
      takeoverResult = result
    },
  }
}

/** Moves time forward and lets the resulting request settle. */
async function tick(clock: FakeClock, ms: number): Promise<void> {
  await act(async () => {
    clock.advance(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function render(fake: FakeLockClient, clock: FakeClock, enabled = true) {
  return renderHook(() =>
    useDocumentLock({
      client: fake.client,
      clock,
      heartbeatIntervalMs: 15_000,
      retryDelayMs: 200,
      enabled,
    }),
  )
}

describe('useDocumentLock', () => {
  it('holds the lock and schedules the first heartbeat after acquiring', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)

    await act(async () => {
      await result.current.acquire()
    })

    expect(result.current.status).toBe('held')
    expect(result.current.lock).toEqual(lock)
    expect(result.current.canAutosave).toBe(true)
    expect(clock.pending).toBe(1)
  })

  it('keeps heartbeating on the 15 second cadence while the lock is alive', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    await tick(clock, 14_999)
    expect(fake.calls.heartbeat).toBe(0)

    await tick(clock, 1)
    expect(fake.calls.heartbeat).toBe(1)
    expect(result.current.lock?.expiresAt).toBe(120_000)

    await tick(clock, 15_000)
    expect(fake.calls.heartbeat).toBe(2)
    expect(result.current.status).toBe('held')
  })

  it('does not heartbeat a lock somebody else holds', async () => {
    const fake = createFakeLockClient()
    fake.answerAcquire({ status: 'held', holder })
    const clock = createFakeClock()
    const { result } = render(fake, clock)

    await act(async () => {
      await result.current.acquire()
    })

    expect(result.current.status).toBe('held_by_other')
    expect(result.current.holder).toEqual(holder)
    expect(clock.pending).toBe(0)
  })

  it('escalates through reconnecting and at risk as heartbeats fail to complete', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    fake.answerHeartbeat(PARTITIONED)
    await tick(clock, 15_000)
    expect(result.current.status).toBe('reconnecting')
    expect(result.current.missedHeartbeats).toBe(1)
    expect(result.current.canAutosave).toBe(false)

    // R5 section 4: retried at once, not at the next 15s tick.
    await tick(clock, 200)
    expect(result.current.status).toBe('at_risk')
    expect(result.current.missedHeartbeats).toBe(2)
    expect(fake.calls.heartbeat).toBe(2)
  })

  it('regains confidence only once a heartbeat actually succeeds', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    fake.answerHeartbeat(PARTITIONED)
    await tick(clock, 15_000)
    await tick(clock, 200)
    expect(result.current.canAutosave).toBe(false)

    // The network is back, but nothing has re-validated the lock yet.
    fake.answerHeartbeat({ status: 'alive', expiresAt: 200_000 })
    expect(result.current.canAutosave).toBe(false)

    await tick(clock, 200)
    expect(result.current.status).toBe('held')
    expect(result.current.missedHeartbeats).toBe(0)
    expect(result.current.canAutosave).toBe(true)
    expect(result.current.lock?.expiresAt).toBe(200_000)
  })

  it('stops heartbeating when the reconnected heartbeat reports the lease lapsed', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    fake.answerHeartbeat({ status: 'expired' })
    await tick(clock, 15_000)

    expect(result.current.status).toBe('lost')
    expect(result.current.lock).toBeNull()
    expect(result.current.canAutosave).toBe(false)
    expect(clock.pending).toBe(0)
  })

  it('names the new holder when the heartbeat reports a takeover', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    fake.answerHeartbeat({ status: 'taken_over', holder })
    await tick(clock, 15_000)

    expect(result.current.status).toBe('held_by_other')
    expect(result.current.holder).toEqual(holder)
    expect(clock.pending).toBe(0)
  })

  it('stops when the heartbeat reports the lock already released', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    fake.answerHeartbeat({ status: 'released' })
    await tick(clock, 15_000)

    expect(result.current.status).toBe('released')
    expect(clock.pending).toBe(0)
  })

  it('takes an active lock over for an admin and resumes heartbeating', async () => {
    const fake = createFakeLockClient()
    fake.answerAcquire({ status: 'held', holder })
    const clock = createFakeClock()
    const { result } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    await act(async () => {
      await result.current.takeover()
    })

    expect(fake.calls.takeover).toBe(1)
    expect(result.current.status).toBe('held')
    expect(result.current.canAutosave).toBe(true)
    expect(clock.pending).toBe(1)
  })

  it('leaves a non-admin exactly where they were when takeover is refused', async () => {
    const fake = createFakeLockClient()
    fake.answerAcquire({ status: 'held', holder })
    fake.answerTakeover({ status: 'forbidden' })
    const clock = createFakeClock()
    const { result } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    await act(async () => {
      await result.current.takeover()
    })

    expect(result.current.status).toBe('held_by_other')
    expect(result.current.holder).toEqual(holder)
    expect(clock.pending).toBe(0)
  })

  it('releases idempotently and does not release again on unmount', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result, unmount } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    await act(async () => {
      await result.current.release()
      await result.current.release()
    })

    expect(fake.calls.release).toBe(2)
    expect(result.current.status).toBe('released')
    expect(clock.pending).toBe(0)

    unmount()
    expect(fake.calls.release).toBe(2)
  })

  it('cancels the heartbeat and releases the lock on unmount', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result, unmount } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })
    expect(clock.pending).toBe(1)

    unmount()

    expect(clock.pending).toBe(0)
    expect(fake.calls.release).toBe(1)
  })

  it('drops a heartbeat reply that lands after unmount', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result, unmount } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    act(() => {
      clock.advance(15_000)
    })
    unmount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fake.calls.heartbeat).toBe(1)
    expect(clock.pending).toBe(0)
  })

  it('drops a failed heartbeat that lands after unmount', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result, unmount } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })

    fake.answerHeartbeat(PARTITIONED)
    act(() => {
      clock.advance(15_000)
    })
    unmount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(clock.pending).toBe(0)
  })

  it('does not start heartbeating when an acquire completes after unmount', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result, unmount } = render(fake, clock)

    let acquired: Promise<void> = Promise.resolve()
    act(() => {
      acquired = result.current.acquire()
    })
    unmount()
    await act(async () => {
      await acquired
    })

    expect(clock.pending).toBe(0)
    // The machine never recorded the lock, so there is nothing to hand back.
    expect(fake.calls.release).toBe(0)
  })

  it('keeps a reader from heartbeating when disabled', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock, false)

    await act(async () => {
      await result.current.acquire()
    })

    expect(result.current.status).toBe('held')
    expect(clock.pending).toBe(0)
  })

  it('falls back to the system clock and the ADR-021 cadence', async () => {
    const fake = createFakeLockClient()
    const { result, unmount } = renderHook(() => useDocumentLock({ client: fake.client }))

    await act(async () => {
      await result.current.acquire()
    })
    expect(result.current.status).toBe('held')

    unmount()
    expect(fake.calls.release).toBe(1)
  })
})
