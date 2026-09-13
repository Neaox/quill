import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import type { OutboxConsumer } from './consumer.ts'
import { MAX_OUTBOX_ATTEMPTS, pollOutboxOnce } from './poller.ts'

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

async function insertEvent(
  id: string,
  type: string,
  availableAt: Date,
  attempts = 0,
): Promise<void> {
  await database.pool.query(
    'INSERT INTO outbox_events (id, type, payload, created_at, available_at, attempts) VALUES ($1, $2, $3::jsonb, $4, $4, $5)',
    [id, type, JSON.stringify({}), availableAt, attempts],
  )
}

describe('pollOutboxOnce', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('processes a due event with a registered consumer', async () => {
    await insertEvent('event-1', 'DocumentCreated', now)
    const handle = vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined)
    const consumers = new Map<string, OutboxConsumer>([
      ['DocumentCreated', { eventType: 'DocumentCreated', handle }],
    ])

    const result = await pollOutboxOnce(database.pool, consumers, { now })
    expect(result).toEqual({ processed: 1, failed: 0, deadLettered: 0 })
    expect(handle).toHaveBeenCalledTimes(1)

    const row = await database.pool.query('SELECT processed_at FROM outbox_events WHERE id = $1', [
      'event-1',
    ])
    expect(row.rows[0]?.processed_at).not.toBeNull()
  })

  it('never claims an event of a type nothing consumes, and is not blocked by one', async () => {
    // The unconsumable event is older, so a batch claimed by age alone would
    // be filled with it and the event that does have a consumer would starve.
    await insertEvent('event-0', 'Unregistered', now)
    await insertEvent('event-1', 'DocumentCreated', now)
    const handle = vi.fn<(payload: unknown) => Promise<void>>()
    const consumers = new Map<string, OutboxConsumer>([
      ['DocumentCreated', { eventType: 'DocumentCreated', handle }],
    ])

    expect(await pollOutboxOnce(database.pool, consumers, { now, batchSize: 1 })).toEqual({
      processed: 1,
      failed: 0,
      deadLettered: 0,
    })

    // Left exactly as it was, for a release that does handle it.
    const row = await database.pool.query(
      'SELECT processed_at, attempts FROM outbox_events WHERE id = $1',
      ['event-0'],
    )
    expect(row.rows[0]).toEqual({ processed_at: null, attempts: 0 })
  })

  it('does not claim an event whose available_at is in the future', async () => {
    await insertEvent('event-1', 'DocumentCreated', new Date(now.getTime() + 60_000))
    const consumers = new Map<string, OutboxConsumer>([
      [
        'DocumentCreated',
        { eventType: 'DocumentCreated', handle: vi.fn<(payload: unknown) => Promise<void>>() },
      ],
    ])
    expect(await pollOutboxOnce(database.pool, consumers, { now })).toEqual({
      processed: 0,
      failed: 0,
      deadLettered: 0,
    })
  })

  it('bumps attempts and backs off available_at on a consumer failure, without throwing', async () => {
    await insertEvent('event-1', 'DocumentCreated', now)
    const handle = vi.fn<(payload: unknown) => Promise<void>>().mockRejectedValue(new Error('boom'))
    const consumers = new Map<string, OutboxConsumer>([
      ['DocumentCreated', { eventType: 'DocumentCreated', handle }],
    ])

    const result = await pollOutboxOnce(database.pool, consumers, { now })
    expect(result).toEqual({ processed: 0, failed: 1, deadLettered: 0 })

    const row = await database.pool.query(
      'SELECT attempts, available_at, processed_at, last_error FROM outbox_events WHERE id = $1',
      ['event-1'],
    )
    const updated = row.rows[0] as {
      attempts: number
      available_at: Date
      processed_at: Date | null
      last_error: string
    }
    expect(updated.attempts).toBe(1)
    expect(updated.processed_at).toBeNull()
    expect(updated.available_at.getTime()).toBe(now.getTime() + 2000)
    expect(updated.last_error).toBe('boom')
  })

  it('caps backoff at 5 minutes for a repeatedly failing event', async () => {
    await insertEvent('event-1', 'DocumentCreated', now, 20)
    const consumers = new Map<string, OutboxConsumer>([
      [
        'DocumentCreated',
        {
          eventType: 'DocumentCreated',
          handle: vi
            .fn<(payload: unknown) => Promise<void>>()
            .mockRejectedValue(new Error('still broken')),
        },
      ],
    ])
    await pollOutboxOnce(database.pool, consumers, { now })

    const row = await database.pool.query('SELECT available_at FROM outbox_events WHERE id = $1', [
      'event-1',
    ])
    const availableAt = (row.rows[0] as { available_at: Date }).available_at
    expect(availableAt.getTime()).toBe(now.getTime() + 5 * 60_000)
  })

  it('records a stringified non-Error rejection as last_error', async () => {
    await insertEvent('event-1', 'DocumentCreated', now)
    const consumers = new Map<string, OutboxConsumer>([
      [
        'DocumentCreated',
        {
          eventType: 'DocumentCreated',
          handle: vi.fn<(payload: unknown) => Promise<void>>().mockRejectedValue('nope'),
        },
      ],
    ])
    await pollOutboxOnce(database.pool, consumers, { now })

    const row = await database.pool.query('SELECT last_error FROM outbox_events WHERE id = $1', [
      'event-1',
    ])
    expect((row.rows[0] as { last_error: string }).last_error).toBe('nope')
  })

  it('respects the batch size', async () => {
    await insertEvent('event-1', 'DocumentCreated', now)
    await insertEvent('event-2', 'DocumentCreated', now)
    const handle = vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined)
    const consumers = new Map<string, OutboxConsumer>([
      ['DocumentCreated', { eventType: 'DocumentCreated', handle }],
    ])

    const result = await pollOutboxOnce(database.pool, consumers, { now, batchSize: 1 })
    expect(result).toEqual({ processed: 1, failed: 0, deadLettered: 0 })
  })

  it('rolls back and rethrows when the claiming query itself fails', async () => {
    await insertEvent('event-1', 'DocumentCreated', now)
    await expect(
      pollOutboxOnce(database.pool, new Map(), { now: new Date(Number.NaN) }),
    ).rejects.toThrow('invalid input syntax')

    // The transaction rolled back: nothing was claimed or mutated.
    const row = await database.pool.query(
      'SELECT processed_at, attempts FROM outbox_events WHERE id = $1',
      ['event-1'],
    )
    expect(row.rows[0]).toEqual({ processed_at: null, attempts: 0 })
  })

  it('never claims an already-processed event again', async () => {
    await insertEvent('event-1', 'DocumentCreated', now)
    const consumers = new Map<string, OutboxConsumer>([
      [
        'DocumentCreated',
        {
          eventType: 'DocumentCreated',
          handle: vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined),
        },
      ],
    ])
    await pollOutboxOnce(database.pool, consumers, { now })
    expect(await pollOutboxOnce(database.pool, consumers, { now })).toEqual({
      processed: 0,
      failed: 0,
      deadLettered: 0,
    })
  })
})

/**
 * Review finding L4: `attempts` grew without limit and nothing dead-lettered,
 * so a permanently failing event kept a claim slot in every batch for ever
 * and its failure lived only in a log nobody reads.
 */
describe('dead-lettering', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('sets an event aside once it has failed too often, and never claims it again', async () => {
    await insertEvent('event-1', 'DocumentCreated', now, MAX_OUTBOX_ATTEMPTS - 1)
    const consumers = new Map<string, OutboxConsumer>([
      [
        'DocumentCreated',
        {
          eventType: 'DocumentCreated',
          handle: vi
            .fn<(payload: unknown) => Promise<void>>()
            .mockRejectedValue(new Error('still broken')),
        },
      ],
    ])

    expect(await pollOutboxOnce(database.pool, consumers, { now })).toEqual({
      processed: 0,
      failed: 0,
      deadLettered: 1,
    })

    const row = await database.pool.query(
      'SELECT dead_lettered_at, last_error, attempts FROM outbox_events WHERE id = $1',
      ['event-1'],
    )
    const set = row.rows[0] as { dead_lettered_at: Date | null; last_error: string }
    expect(set.dead_lettered_at).not.toBeNull()
    // The reason is kept, which is the point of setting it aside rather than
    // marking it processed.
    expect(set.last_error).toBe('still broken')

    // And it is out of the claim window for good.
    expect(await pollOutboxOnce(database.pool, consumers, { now })).toEqual({
      processed: 0,
      failed: 0,
      deadLettered: 0,
    })
  })
})

/**
 * Mail is queued so that a request costs the same whether or not the address
 * has an account (review finding H3). The token in the queued link is the one
 * place a live credential is written to the database, and this is what keeps
 * ADR-011's "a database read never yields a usable token" true afterwards.
 */
describe('redacting a delivered payload', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('stores what the consumer hands back when it marks the event processed', async () => {
    await database.pool.query(
      'INSERT INTO outbox_events (id, type, payload, created_at, available_at) VALUES ($1, $2, $3::jsonb, $4, $4)',
      ['mail-1', 'MailRequested', JSON.stringify({ secret: 'live-token' }), now],
    )
    const consumers = new Map<string, OutboxConsumer>([
      [
        'MailRequested',
        {
          eventType: 'MailRequested',
          handle: vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined),
          redactPayload: () => ({ secret: '[redacted after delivery]' }),
        },
      ],
    ])

    await pollOutboxOnce(database.pool, consumers, { now })

    const row = await database.pool.query('SELECT payload FROM outbox_events WHERE id = $1', [
      'mail-1',
    ])
    expect(row.rows[0]).toEqual({ payload: { secret: '[redacted after delivery]' } })
  })
})
