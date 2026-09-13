import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createAuditWriter } from './audit-writer.ts'
import { createUserRepository } from './user-repository.ts'

let database: TestDatabase
let audit: ReturnType<typeof createAuditWriter>
const ALICE = userId('00000000-0000-4000-8000-000000000001')

beforeAll(async () => {
  database = await createTestDatabase()
  audit = createAuditWriter(database.db)
  await createUserRepository(database.db).create({
    id: ALICE,
    email: 'ada@example.com',
    displayName: 'Ada',
    now: new Date('2026-01-01T00:00:00.000Z'),
  })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM audit_events')
})

describe('AuditWriter', () => {
  it('writes an event with an actor and metadata', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    await audit.write({
      id: 'audit-1',
      type: 'GrantChanged',
      actorUserId: ALICE,
      targetType: 'workspace',
      targetId: 'workspace-1',
      metadata: { role: 'admin' },
      now,
    })

    const rows = await database.pool.query('SELECT * FROM audit_events WHERE id = $1', ['audit-1'])
    const row = rows.rows[0] as { actor_user_id: string; metadata: unknown; target_type: string }
    expect(row.actor_user_id).toBe(ALICE)
    expect(row.metadata).toEqual({ role: 'admin' })
    expect(row.target_type).toBe('workspace')
  })

  it('writes an event with no actor and no metadata', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    await audit.write({
      id: 'audit-2',
      type: 'DocumentDeleted',
      actorUserId: null,
      targetType: 'document',
      targetId: 'doc-1',
      metadata: undefined,
      now,
    })

    const rows = await database.pool.query('SELECT * FROM audit_events WHERE id = $1', ['audit-2'])
    const row = rows.rows[0] as { actor_user_id: string | null; metadata: unknown }
    expect(row.actor_user_id).toBeNull()
    expect(row.metadata).toEqual({})
  })
})
