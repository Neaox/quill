import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createOutboxWriter } from './outbox-writer.ts'

let database: TestDatabase
let outbox: ReturnType<typeof createOutboxWriter>

beforeAll(async () => {
  database = await createTestDatabase()
  outbox = createOutboxWriter(database.db)
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM outbox_events')
})

describe('OutboxWriter', () => {
  it('writes an event immediately available for processing', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    await outbox.write({
      id: 'event-1',
      type: 'DocumentCreated',
      payload: { documentId: 'doc-1' },
      now,
    })

    const rows = await database.pool.query(
      'SELECT id, type, payload, created_at, available_at, processed_at, attempts FROM outbox_events WHERE id = $1',
      ['event-1'],
    )
    expect(rows.rowCount).toBe(1)
    const row = rows.rows[0] as {
      id: string
      type: string
      payload: unknown
      available_at: Date
      processed_at: Date | null
      attempts: number
    }
    expect(row.type).toBe('DocumentCreated')
    expect(row.payload).toEqual({ documentId: 'doc-1' })
    expect(row.available_at).toEqual(now)
    expect(row.processed_at).toBeNull()
    expect(row.attempts).toBe(0)
  })
})

describe('OutboxWriter.writeMany', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('writes several events in one statement, each immediately available', async () => {
    const statements: string[] = []
    const original = database.pool.query.bind(database.pool)
    const spy = (text: unknown, ...rest: unknown[]) => {
      statements.push(typeof text === 'string' ? text : String(Reflect.get(Object(text), 'text')))
      return Reflect.apply(original, database.pool, [text, ...rest])
    }
    Object.defineProperty(database.pool, 'query', { value: spy, configurable: true })
    try {
      await outbox.writeMany(
        Array.from({ length: 5 }, (_, index) => ({
          id: `event-${index}`,
          type: 'LinkPreviewRequested',
          payload: { index },
          now,
        })),
      )
    } finally {
      Reflect.deleteProperty(database.pool, 'query')
    }
    expect(statements.filter((statement) => /^insert/iu.test(statement))).toHaveLength(1)
    const rows = await database.pool.query('SELECT id, payload FROM outbox_events ORDER BY id')
    expect(rows.rows.map((row: { id: string }) => row.id)).toEqual([
      'event-0',
      'event-1',
      'event-2',
      'event-3',
      'event-4',
    ])
  })

  it('does nothing for no events', async () => {
    await outbox.writeMany([])
    const rows = await database.pool.query('SELECT 1 FROM outbox_events')
    expect(rows.rowCount).toBe(0)
  })
})
