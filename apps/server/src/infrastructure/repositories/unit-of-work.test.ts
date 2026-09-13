import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'
import { createFakeIdGenerator } from '@quill/application/test-support'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createUnitOfWork } from './unit-of-work.ts'

let database: TestDatabase
let uow: ReturnType<typeof createUnitOfWork>

beforeAll(async () => {
  database = await createTestDatabase()
  uow = createUnitOfWork(database.db, database.pool, createFakeIdGenerator())
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM users')
  await database.pool.query('DELETE FROM outbox_events')
})

describe('createUnitOfWork', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('commits every repository write made inside run()', async () => {
    const id = userId('00000000-0000-4000-8000-000000000001')
    await uow.run(async (repos) => {
      await repos.users.create({ id, email: 'ada@example.com', displayName: 'Ada', now })
      await repos.outbox.write({ id: 'event-1', type: 'DocumentCreated', payload: {}, now })
    })

    expect(await uow.repos.users.findById(id)).not.toBeNull()
    const events = await database.pool.query('SELECT id FROM outbox_events')
    expect(events.rowCount).toBe(1)
  })

  it('rolls back every repository write when the callback throws', async () => {
    const id = userId('00000000-0000-4000-8000-000000000002')
    await expect(
      uow.run(async (repos) => {
        await repos.users.create({ id, email: 'bob@example.com', displayName: 'Bob', now })
        await repos.outbox.write({ id: 'event-2', type: 'DocumentCreated', payload: {}, now })
        throw new Error('simulated failure after both writes')
      }),
    ).rejects.toThrow('simulated failure after both writes')

    expect(await uow.repos.users.findById(id)).toBeNull()
    const events = await database.pool.query('SELECT id FROM outbox_events WHERE id = $1', [
      'event-2',
    ])
    expect(events.rowCount).toBe(0)
  })

  it('exposes repos bound to the pool for reads and writes outside a transaction', async () => {
    const id = userId('00000000-0000-4000-8000-000000000003')
    await uow.repos.users.create({ id, email: 'carol@example.com', displayName: 'Carol', now })
    expect(await uow.repos.users.findById(id)).not.toBeNull()
  })
})
