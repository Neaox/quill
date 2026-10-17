import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userId } from '@quill/domain'
import { createEventBus, grantCreated } from '@quill/application'
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

const GRANT = {
  grantId: 'grant-1',
  principalKind: 'public',
  principalId: null,
  scopeKind: 'collection',
  scopeId: 'collection-1',
  role: 'viewer',
  effect: 'allow',
} as const

describe('createUnitOfWork', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('commits every repository write made inside run()', async () => {
    const id = userId('00000000-0000-4000-8000-000000000001')
    await uow.run(async (repos) => {
      await repos.users.create({ id, email: 'ada@example.com', displayName: 'Ada', now })
      await repos.events.record(grantCreated, GRANT, now)
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
        await repos.events.record(grantCreated, GRANT, now)
        throw new Error('simulated failure after both writes')
      }),
    ).rejects.toThrow('simulated failure after both writes')

    expect(await uow.repos.users.findById(id)).toBeNull()
    const events = await database.pool.query('SELECT id FROM outbox_events')
    expect(events.rowCount).toBe(0)
  })

  it('exposes repos bound to the pool for reads and writes outside a transaction', async () => {
    const id = userId('00000000-0000-4000-8000-000000000003')
    await uow.repos.users.create({ id, email: 'carol@example.com', displayName: 'Carol', now })
    expect(await uow.repos.users.findById(id)).not.toBeNull()
  })

  describe('announcing what a transaction recorded', () => {
    const aUnitOfWorkWithABus = () => {
      const bus = createEventBus({ onError: vi.fn<(error: unknown) => void>() })
      const rowsSeenByListener: number[] = []
      bus.subscribe(grantCreated, async () => {
        const { rowCount } = await database.pool.query('SELECT id FROM outbox_events')
        rowsSeenByListener.push(rowCount ?? 0)
      })
      return {
        uow: createUnitOfWork(database.db, database.pool, createFakeIdGenerator(), bus),
        rowsSeenByListener,
      }
    }

    it('tells the bus after the commit, when the row it announces can be read by anybody', async () => {
      const { uow: announcing, rowsSeenByListener } = aUnitOfWorkWithABus()

      await announcing.run(async (repos) => {
        await repos.events.record(grantCreated, GRANT, now)
        expect(rowsSeenByListener).toEqual([])
      })
      expect(rowsSeenByListener).toEqual([1])
    })

    it('never tells the bus about a transaction that rolled back', async () => {
      const { uow: announcing, rowsSeenByListener } = aUnitOfWorkWithABus()

      await expect(
        announcing.run(async (repos) => {
          await repos.events.record(grantCreated, GRANT, now)
          throw new Error('rolled back')
        }),
      ).rejects.toThrow('rolled back')
      expect(rowsSeenByListener).toEqual([])
    })

    it('tells the bus about an event recorded outside a transaction, which commits as it is written', async () => {
      const { uow: announcing, rowsSeenByListener } = aUnitOfWorkWithABus()

      await announcing.repos.events.record(grantCreated, GRANT, now)
      await vi.waitFor(() => expect(rowsSeenByListener).toEqual([1]))
    })

    it('hands back what the transaction returned, and does not fail because a listener did', async () => {
      const bus = createEventBus({ onError: vi.fn<(error: unknown) => void>() })
      bus.subscribe(grantCreated, () => {
        throw new Error('listener broke')
      })
      const announcing = createUnitOfWork(database.db, database.pool, createFakeIdGenerator(), bus)

      const result = await announcing.run(async (repos) => {
        await repos.events.record(grantCreated, GRANT, now)
        return 'committed'
      })
      expect(result).toBe('committed')
    })
  })
})
