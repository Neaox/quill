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
