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
import type { Connectivity } from './connectivity.ts'
import { createFakeConnectivity } from './connectivity.ts'
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

function render(
  fake: FakeLockClient,
  clock: FakeClock,
  enabled = true,
  connectivity: Connectivity = createFakeConnectivity(),
) {
  return renderHook(() =>
    useDocumentLock({
      client: fake.client,
      clock,
      heartbeatIntervalMs: 15_000,
      retryBackoff: { baseMs: 200, capMs: 2000 },
      random: () => 1,
      connectivity,
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

/** The production schedule: an immediate retry, then 1s, 2s, 4s... capped at 10s. */
function renderWithDefaults(fake: FakeLockClient, clock: FakeClock, connectivity: Connectivity) {
  return renderHook(() =>
    useDocumentLock({ client: fake.client, clock, random: () => 1, connectivity }),
  )
}

describe('useDocumentLock through an outage (audit P0-4)', () => {
  it('keeps trying to take the lock when the server is down as the editor opens', async () => {
    const clock = createFakeClock()
    let failures = 2
    let attempts = 0
    const client: LockClient = {
      acquire: async () => {
        attempts += 1
        if (failures > 0) {
          failures -= 1
          throw new TypeError('Failed to fetch')
        }
        return { status: 'acquired', lock }
      },
      heartbeat: async () => ({ status: 'alive', expiresAt: 120_000 }),
      release: async () => {},
      takeover: async () => ({ status: 'acquired', lock }),
    }
    const connectivity = createFakeConnectivity()
    const { result } = renderHook(() =>
      useDocumentLock({ client, clock, random: () => 1, connectivity }),
    )

    // A failed acquire used to reject out of the caller's `void acquire()`
    // and leave the lock "opening" for good, with autosave never allowed.
    await act(async () => {
      await result.current.acquire()
    })
    expect(result.current.status).toBe('acquiring')
    expect(result.current.canAutosave).toBe(false)

    await tick(clock, 1000)
    expect(attempts).toBe(2)
    await tick(clock, 2000)

    expect(attempts).toBe(3)
    expect(result.current.status).toBe('held')
    expect(result.current.canAutosave).toBe(true)
  })

  it('does not retry an acquire the session has moved on from', async () => {
    const clock = createFakeClock()
    const { promise, reject } = Promise.withResolvers<AcquireResult>()
    let attempts = 0
    const client: LockClient = {
      acquire: () => {
        attempts += 1
        return promise
      },
      heartbeat: async () => ({ status: 'alive', expiresAt: 120_000 }),
      release: async () => {},
      takeover: async () => ({ status: 'acquired', lock }),
    }
    const { result } = renderHook(() =>
      useDocumentLock({ client, clock, random: () => 1, connectivity: createFakeConnectivity() }),
    )

    let acquiring: Promise<void> = Promise.resolve()
    act(() => {
      acquiring = result.current.acquire()
    })
    await act(async () => {
      await result.current.release()
    })
    await act(async () => {
      reject(new TypeError('Failed to fetch'))
      await acquiring
    })
    await tick(clock, 60_000)

    expect(result.current.status).toBe('released')
    expect(attempts).toBe(1)
  })

  it('stops trying to take the lock once the editor has gone', async () => {
    const clock = createFakeClock()
    let attempts = 0
    const client: LockClient = {
      acquire: async () => {
        attempts += 1
        throw new TypeError('Failed to fetch')
      },
      heartbeat: async () => ({ status: 'alive', expiresAt: 120_000 }),
      release: async () => {},
      takeover: async () => ({ status: 'acquired', lock }),
    }
    const { result, unmount } = renderHook(() =>
      useDocumentLock({ client, clock, random: () => 1, connectivity: createFakeConnectivity() }),
    )
    await act(async () => {
      await result.current.acquire()
    })
    unmount()
    await tick(clock, 60_000)

    expect(attempts).toBe(1)
    expect(clock.pending).toBe(0)
  })

  async function acquireThenPartition(fake: FakeLockClient, clock: FakeClock) {
    const connectivity = createFakeConnectivity()
    const view = renderWithDefaults(fake, clock, connectivity)
    await act(async () => {
      await view.result.current.acquire()
    })
    fake.answerHeartbeat(PARTITIONED)
    return { ...view, connectivity }
  }

  it('sends a handful of heartbeats over a 60 second partition, not hundreds', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result } = await acquireThenPartition(fake, clock)

    await tick(clock, 15_000)
    for (let elapsed = 0; elapsed < 60_000; elapsed += 100) await tick(clock, 100)

    // 15s, then at once, then 1, 2, 4, 8, 10, 10, 10, 10 seconds later.
    expect(fake.calls.heartbeat).toBe(10)
    // Uncertain, and saying so, rather than hammering the server.
    expect(result.current.status).toBe('at_risk')
    expect(result.current.canAutosave).toBe(false)
  })

  it('pauses retries while the browser is offline, and retries the moment it is back', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result, connectivity } = await acquireThenPartition(fake, clock)

    await tick(clock, 15_000)
    expect(fake.calls.heartbeat).toBe(1)
    act(() => {
      connectivity.setOnline(false)
    })
    await tick(clock, 120_000)
    expect(fake.calls.heartbeat).toBe(1)

    fake.answerHeartbeat({ status: 'alive', expiresAt: 500_000 })
    act(() => {
      connectivity.setOnline(true)
    })
    await tick(clock, 0)

    expect(fake.calls.heartbeat).toBe(2)
    expect(result.current.status).toBe('held')
  })

  it('pauses retries while the tab is hidden, and retries when it is shown', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const { result, connectivity } = await acquireThenPartition(fake, clock)

    act(() => {
      connectivity.setVisible(false)
    })
    await tick(clock, 15_000)
    await tick(clock, 60_000)
    expect(fake.calls.heartbeat).toBe(1)
    expect(result.current.status).toBe('reconnecting')

    fake.answerHeartbeat({ status: 'alive', expiresAt: 500_000 })
    act(() => {
      connectivity.setVisible(true)
    })
    await tick(clock, 0)
    expect(result.current.status).toBe('held')
  })

  it('keeps the healthy cadence while hidden, so switching tabs does not cost the lock', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    const connectivity = createFakeConnectivity()
    const { result } = renderWithDefaults(fake, clock, connectivity)
    await act(async () => {
      await result.current.acquire()
    })

    act(() => {
      connectivity.setVisible(false)
    })
    await tick(clock, 15_000)
    await tick(clock, 15_000)
    expect(fake.calls.heartbeat).toBe(2)
    expect(result.current.status).toBe('held')
  })
})

describe('useDocumentLock: asking again while somebody else edits', () => {
  it('keeps saying who holds the lock while it asks, then takes it when it is free', async () => {
    const fake = createFakeLockClient()
    const clock = createFakeClock()
    fake.answerAcquire({ status: 'held', holder })
    const { result } = render(fake, clock)
    await act(async () => {
      await result.current.acquire()
    })
    expect(result.current.status).toBe('held_by_other')

    let asking: Promise<void> | undefined
    act(() => {
      asking = result.current.reacquire()
    })
    expect(result.current.status).toBe('held_by_other')
    await act(async () => {
      await asking
    })
    expect(result.current.holder).toEqual(holder)

    fake.answerAcquire({ status: 'acquired', lock })
    await act(async () => {
      await result.current.reacquire()
    })
    expect(result.current.status).toBe('held')
    await tick(clock, 15_000)
    expect(fake.calls.heartbeat).toBe(1)
  })

  it('treats a request that failed as no answer at all', async () => {
    const fake = createFakeLockClient()
    fake.answerAcquire({ status: 'held', holder })
    const { result } = render(fake, createFakeClock())
    await act(async () => {
      await result.current.acquire()
    })
    const failing = { ...fake.client, acquire: () => Promise.reject(new Error('offline')) }
    const { result: other } = renderHook(() =>
      useDocumentLock({ client: failing, clock: createFakeClock() }),
    )
    await act(async () => {
      await other.current.reacquire()
    })
    expect(other.current.status).toBe('idle')
    expect(result.current.status).toBe('held_by_other')
  })
})
