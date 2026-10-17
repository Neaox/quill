import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createNotificationRepository } from './notification-repository.ts'

let database: TestDatabase
let notifications: ReturnType<typeof createNotificationRepository>
const NOW = new Date('2026-01-01T00:00:00.000Z')

beforeAll(async () => {
  database = await createTestDatabase()
  notifications = createNotificationRepository(database.db)
}, 30_000)

afterAll(async () => {
  await database.drop()
})

describe('NotificationRepository: asking for nothing', () => {
  it('writes no rows when given none', async () => {
    expect(await notifications.insertMany([])).toBe(0)
  })

  it('marks nothing read for an empty list of ids', async () => {
    expect(
      await notifications.markRead({
        userId: userId('00000000-0000-4000-8000-0000000000a1'),
        ids: [],
        now: NOW,
      }),
    ).toBe(0)
  })
})
