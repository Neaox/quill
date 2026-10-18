import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { DeferEvent } from './consumer.ts'
import type { OutboxConsumer } from './consumer.ts'
import { pollOutboxLane } from './lane.ts'
import { MAX_OUTBOX_ATTEMPTS } from './poller.ts'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM outbox_events')
})

const NOW = new Date('2026-01-01T00:00:00.000Z')
const later = (milliseconds: number) => new Date(NOW.getTime() + milliseconds)
const nap = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds))

async function insertEvent(id: string, type = 'Slow', attempts = 0, availableAt = NOW) {
  await database.pool.query(
    'INSERT INTO outbox_events (id, type, payload, created_at, available_at, attempts) VALUES ($1, $2, $3::jsonb, $4, $4, $5)',
    [id, type, JSON.stringify({ id }), availableAt, attempts],
  )
}

async function rowOf(id: string) {
  const { rows } = await database.pool.query(
    'SELECT processed_at, attempts, available_at, last_error, dead_lettered_at, payload FROM outbox_events WHERE id = $1',
    [id],
  )
  return rows[0]
}

const laneOf = (handle: OutboxConsumer['handle'], extra: Partial<OutboxConsumer> = {}) =>
  new Map<string, OutboxConsumer>([['Slow', { eventType: 'Slow', handle, ...extra }]])

describe('pollOutboxLane: what it takes', () => {
  it('processes a due event of its type and marks it done', async () => {
    await insertEvent('a')
    const handle = vi.fn<OutboxConsumer['handle']>(async () => undefined)
    const result = await pollOutboxLane(database.pool, laneOf(handle), { now: NOW })
    expect(result).toEqual({ processed: 1, failed: 0, deferred: 0, deadLettered: 0 })
    expect(handle).toHaveBeenCalledWith({ id: 'a' })
    expect((await rowOf('a')).processed_at).not.toBeNull()
  })

  it('leaves events of other types, and events not yet due, alone', async () => {
    await insertEvent('other', 'Quick')
    await insertEvent('future', 'Slow', 0, later(60_000))
    const handle = vi.fn<OutboxConsumer['handle']>(async () => undefined)
    const result = await pollOutboxLane(database.pool, laneOf(handle), { now: NOW })
    expect(result.processed).toBe(0)
    expect(handle).not.toHaveBeenCalled()
  })

  it('stores the redacted payload a consumer asks for', async () => {
    await insertEvent('a')
    await pollOutboxLane(
      database.pool,
      laneOf(async () => undefined, { redactPayload: () => ({ redacted: true }) }),
      { now: NOW },
    )
    expect((await rowOf('a')).payload).toEqual({ redacted: true })
  })

  it('takes events oldest first, up to the batch size', async () => {
    await insertEvent('old', 'Slow', 0, later(-2000))
    await insertEvent('mid', 'Slow', 0, later(-1000))
    await insertEvent('new', 'Slow', 0, NOW)
    const seen: unknown[] = []
    await pollOutboxLane(
      database.pool,
      laneOf(async (payload) => {
        seen.push(payload)
      }),
      { now: NOW, batchSize: 2, concurrency: 1 },
    )
    expect(seen).toEqual([{ id: 'old' }, { id: 'mid' }])
  })
})

describe('pollOutboxLane: working in parallel without holding the database', () => {
  it('runs events at once up to the concurrency, and no more', async () => {
    for (const id of ['1', '2', '3', '4', '5', '6']) await insertEvent(id)
    let running = 0
    let peak = 0
    const gate = Promise.withResolvers<void>()
    const lane = pollOutboxLane(
      database.pool,
      laneOf(async () => {
        running += 1
        peak = Math.max(peak, running)
        await gate.promise
        running -= 1
      }),
      { now: NOW, concurrency: 3 },
    )
    // Wait until three are running and see that a fourth does not start behind them.
    await vi.waitFor(() => expect(running).toBe(3))
    await nap(50)
    expect(running).toBe(3)
    gate.resolve()
    const result = await lane
    expect(peak).toBe(3)
    expect(result.processed).toBe(6)
  })

  it('holds no lock on its events while the work runs', async () => {
    await insertEvent('a')
    let lockable = false
    await pollOutboxLane(
      database.pool,
      laneOf(async () => {
        // If a transaction still held the row, this would fail at once.
        await database.pool.query('SELECT id FROM outbox_events WHERE id = $1 FOR UPDATE NOWAIT', [
          'a',
        ])
        lockable = true
      }),
      { now: NOW },
    )
    expect(lockable).toBe(true)
  })

  it('does not let a slow event delay the main outbox, which is a different poll', async () => {
    await insertEvent('slow')
    const gate = Promise.withResolvers<void>()
    const lane = pollOutboxLane(
      database.pool,
      laneOf(async () => {
        await gate.promise
      }),
      { now: NOW },
    )
    await nap(50)
    // While the lane is busy, a connection is free for other work.
    const { rows } = await database.pool.query('SELECT 1 AS one')
    expect(rows[0]?.one).toBe(1)
    gate.resolve()
    await lane
  })
})

describe('pollOutboxLane: leases', () => {
  it('does not hand an event to a second poll while the first is working on it', async () => {
    await insertEvent('a')
    const gate = Promise.withResolvers<void>()
    const first = pollOutboxLane(
      database.pool,
      laneOf(() => gate.promise),
      { now: NOW },
    )
    await nap(50)
    const handle = vi.fn<OutboxConsumer['handle']>(async () => undefined)
    const second = await pollOutboxLane(database.pool, laneOf(handle), { now: later(1000) })
    expect(second.processed).toBe(0)
    expect(handle).not.toHaveBeenCalled()
    gate.resolve()
    await first
  })

  it('takes an event back once its lease has run out, as when a worker died', async () => {
    await insertEvent('a')
    await database.pool.query("UPDATE outbox_events SET available_at = $1 WHERE id = 'a'", [
      later(120_000),
    ])
    const handle = vi.fn<OutboxConsumer['handle']>(async () => undefined)
    expect(
      (await pollOutboxLane(database.pool, laneOf(handle), { now: later(119_000) })).processed,
    ).toBe(0)
    expect(
      (await pollOutboxLane(database.pool, laneOf(handle), { now: later(121_000) })).processed,
    ).toBe(1)
  })
})

describe("pollOutboxLane: when it is not the event's fault", () => {
  it('puts a deferred event back for the time it named, without counting an attempt', async () => {
    await insertEvent('a')
    const result = await pollOutboxLane(
      database.pool,
      laneOf(async () => {
        throw new DeferEvent(10_000, 'rate limit')
      }),
      { now: NOW, random: () => 0.5 },
    )
    expect(result).toEqual({ processed: 0, failed: 0, deferred: 1, deadLettered: 0 })
    const row = await rowOf('a')
    expect(row.attempts).toBe(0)
    expect(row.processed_at).toBeNull()
    expect(row.dead_lettered_at).toBeNull()
    // random 0.5 is the middle of the jitter range, so exactly the time asked for.
    expect(row.available_at).toEqual(later(10_000))
    expect(row.last_error).toContain('rate limit')
  })

  it('spreads deferrals with jitter, by up to a quarter either way', async () => {
    await insertEvent('low')
    await insertEvent('high')
    const lane = (random: number) =>
      pollOutboxLane(
        database.pool,
        laneOf(async () => {
          throw new DeferEvent(10_000, 'busy')
        }),
        { now: NOW, random: () => random, batchSize: 1 },
      )
    await lane(0)
    await lane(0.999999)
    const available = [await rowOf('low'), await rowOf('high')].map(
      (row) => row.available_at.getTime() - NOW.getTime(),
    )
    expect(available[0]).toBe(7500)
    expect(available[1]).toBeGreaterThan(12_490)
    expect(available[1]).toBeLessThanOrEqual(12_500)
  })

  it('never gives up on an event for being deferred, however often', async () => {
    await insertEvent('a')
    for (let round = 0; round < MAX_OUTBOX_ATTEMPTS * 2; round += 1) {
      // eslint-disable-next-line no-await-in-loop -- each round is the next poll of the same event.
      await pollOutboxLane(
        database.pool,
        laneOf(async () => {
          throw new DeferEvent(1, 'busy')
        }),
        { now: later(round * 1000) },
      )
    }
    const row = await rowOf('a')
    expect(row.attempts).toBe(0)
    expect(row.dead_lettered_at).toBeNull()
  })
})

describe('pollOutboxLane: when the work itself fails', () => {
  it('counts an attempt and backs off, as the main poller does', async () => {
    await insertEvent('a')
    const result = await pollOutboxLane(
      database.pool,
      laneOf(async () => {
        throw new Error('boom')
      }),
      { now: NOW },
    )
    expect(result).toEqual({ processed: 0, failed: 1, deferred: 0, deadLettered: 0 })
    const row = await rowOf('a')
    expect(row.attempts).toBe(1)
    expect(row.last_error).toBe('boom')
    expect(row.available_at).toEqual(later(2000))
  })

  it('sets an event aside once it has used its attempts', async () => {
    await insertEvent('a', 'Slow', MAX_OUTBOX_ATTEMPTS - 1)
    const result = await pollOutboxLane(
      database.pool,
      laneOf(async () => {
        throw new Error('boom')
      }),
      { now: NOW },
    )
    expect(result.deadLettered).toBe(1)
    expect((await rowOf('a')).dead_lettered_at).not.toBeNull()
  })

  it('treats a handler that never finishes as a failure, and frees its place', async () => {
    await insertEvent('a')
    await insertEvent('b')
    const result = await pollOutboxLane(
      database.pool,
      laneOf((payload) =>
        typeof payload === 'object' && payload !== null && 'id' in payload && payload.id === 'a'
          ? new Promise<void>(() => undefined)
          : Promise.resolve(),
      ),
      { now: NOW, concurrency: 1, handlerTimeoutMs: 50 },
    )
    expect(result).toEqual({ processed: 1, failed: 1, deferred: 0, deadLettered: 0 })
    expect((await rowOf('a')).last_error).toContain('No result within 50 ms')
  })

  it('finishes the rest and then reports it when the database fails mid-batch', async () => {
    await insertEvent('a')
    const breaking = Object.assign(Object.create(database.pool), {
      query: vi.fn<() => Promise<never>>().mockRejectedValue(new Error('connection lost')),
    })
    await expect(
      pollOutboxLane(
        breaking,
        laneOf(async () => undefined),
        { now: NOW },
      ),
    ).rejects.toThrow('connection lost')
  })
})

describe('pollOutboxLane: when claiming fails', () => {
  it('rolls back, gives the connection back, and reports it', async () => {
    const statements: string[] = []
    const release = vi.fn<() => void>()
    const client = {
      query: vi.fn<(statement: string) => Promise<{ rows: never[] }>>(async (statement) => {
        statements.push(statement.trim().split(/\s/u)[0] ?? '')
        if (statement.trim().startsWith('SELECT')) throw new Error('claim failed')
        return { rows: [] }
      }),
      release,
    }
    const pool = { connect: async () => client }
    await expect(
      // A pool with only the two things the claim uses.
      pollOutboxLane(
        Object.assign(Object.create(database.pool), pool),
        laneOf(async () => undefined),
        {
          now: NOW,
        },
      ),
    ).rejects.toThrow('claim failed')
    expect(statements).toEqual(['BEGIN', 'SELECT', 'ROLLBACK'])
    expect(release).toHaveBeenCalledOnce()
  })
})
