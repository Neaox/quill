import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { acquireLock, heartbeat, HEARTBEAT_INTERVAL_MS, LOCK_TTL_MS, releaseLock } from './lock.ts'
import { at, ensureSchema, pool, resetTables } from './test-helpers.ts'

beforeAll(async () => {
  await ensureSchema()
})

beforeEach(async () => {
  await resetTables()
})

afterAll(async () => {
  await pool.end()
})

const DOC = 'doc-1'

describe('expiry', () => {
  // (b) Expiry after 60s without heartbeat allows a new holder.
  it('lets a new holder acquire once the previous lock has expired', async () => {
    const t0 = at(0)
    const first = await acquireLock(pool, {
      documentId: DOC,
      userId: 'alice',
      sessionId: 'alice-tab-1',
      now: t0,
    })
    expect(first.ok).toBe(true)

    const justBeforeExpiry = new Date(t0.getTime() + LOCK_TTL_MS - 1)
    const tooEarly = await acquireLock(pool, {
      documentId: DOC,
      userId: 'bob',
      sessionId: 'bob-tab-1',
      now: justBeforeExpiry,
    })
    expect(tooEarly.ok).toBe(false)

    const afterExpiry = new Date(t0.getTime() + LOCK_TTL_MS + 1)
    const second = await acquireLock(pool, {
      documentId: DOC,
      userId: 'bob',
      sessionId: 'bob-tab-1',
      now: afterExpiry,
    })
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.lock.holder_user_id).toBe('bob')
    }
  })
})

describe('heartbeat', () => {
  // (c) Heartbeat every 15s keeps the lock held past the 60s TTL.
  it('keeps the lock alive across many heartbeat-interval ticks', async () => {
    const t0 = at(0)
    const acquired = await acquireLock(pool, {
      documentId: DOC,
      userId: 'alice',
      sessionId: 'alice-tab-1',
      now: t0,
    })
    expect(acquired.ok).toBe(true)

    // 20 heartbeats * 15s = 300s of elapsed wall-clock time, four times the raw TTL.
    for (let tick = 1; tick <= 20; tick += 1) {
      const now = new Date(t0.getTime() + tick * HEARTBEAT_INTERVAL_MS)
      const result = await heartbeat(pool, { documentId: DOC, sessionId: 'alice-tab-1', now })
      expect(result.ok, `heartbeat tick ${tick} should succeed`).toBe(true)
    }

    // A rival still cannot acquire shortly after the last heartbeat.
    const shortlyAfter = new Date(t0.getTime() + 20 * HEARTBEAT_INTERVAL_MS + 1000)
    const rival = await acquireLock(pool, {
      documentId: DOC,
      userId: 'bob',
      sessionId: 'bob-tab-1',
      now: shortlyAfter,
    })
    expect(rival.ok).toBe(false)
  })

  // (g) Simulated network partition: client stops heartbeating, then resumes after expiry.
  // It must be told it lost the lock, not silently kept alive.
  it('reports loss to a client that resumes heartbeating after expiry', async () => {
    const t0 = at(0)
    await acquireLock(pool, { documentId: DOC, userId: 'alice', sessionId: 'alice-tab-1', now: t0 })

    // Partition: no heartbeat sent for far longer than the TTL.
    const resumedAfterPartition = new Date(t0.getTime() + LOCK_TTL_MS + 5_000)
    const result = await heartbeat(pool, {
      documentId: DOC,
      sessionId: 'alice-tab-1',
      now: resumedAfterPartition,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('expired')
    }

    // And distinctly: if someone else has since taken the document, that must also be visible.
    const tookOverAt = new Date(t0.getTime() + LOCK_TTL_MS + 6_000)
    await acquireLock(pool, {
      documentId: DOC,
      userId: 'bob',
      sessionId: 'bob-tab-1',
      now: tookOverAt,
    })

    const laterHeartbeat = await heartbeat(pool, {
      documentId: DOC,
      sessionId: 'alice-tab-1',
      now: new Date(tookOverAt.getTime() + 1000),
    })
    expect(laterHeartbeat.ok).toBe(false)
    if (!laterHeartbeat.ok) {
      expect(laterHeartbeat.reason).toBe('taken_over')
    }
  })
})

describe('release', () => {
  // (f) Release on close frees the lock immediately — no need to wait for expiry.
  it('lets another client acquire immediately after release, with no elapsed time', async () => {
    const t0 = at(0)
    await acquireLock(pool, { documentId: DOC, userId: 'alice', sessionId: 'alice-tab-1', now: t0 })

    const released = await releaseLock(pool, { documentId: DOC, sessionId: 'alice-tab-1' })
    expect(released.ok).toBe(true)

    const immediate = await acquireLock(pool, {
      documentId: DOC,
      userId: 'bob',
      sessionId: 'bob-tab-1',
      now: t0, // same instant — proves this isn't relying on expiry at all
    })
    expect(immediate.ok).toBe(true)
  })

  it('refuses to release a lock the caller does not hold', async () => {
    const t0 = at(0)
    await acquireLock(pool, { documentId: DOC, userId: 'alice', sessionId: 'alice-tab-1', now: t0 })
    const result = await releaseLock(pool, { documentId: DOC, sessionId: 'someone-else' })
    expect(result.ok).toBe(false)
  })
})
