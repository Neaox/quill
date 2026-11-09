import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { userId, workspaceId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createNotificationRepository } from './notification-repository.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createUserRepository } from './user-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'

let database: TestDatabase
let notifications: ReturnType<typeof createNotificationRepository>
const NOW = new Date('2026-01-01T00:00:00.000Z')
const ADA = userId('00000000-0000-4000-8000-0000000000a1')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')

beforeAll(async () => {
  database = await createTestDatabase()
  notifications = createNotificationRepository(database.db)
  await createUserRepository(database.db).create({
    id: ADA,
    email: 'ada@example.com',
    displayName: 'Ada',
    now: NOW,
  })
  await createUnitRepository(database.db).create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await createWorkspaceRepository(database.db).create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Handbook',
    slug: 'handbook',
    now: NOW,
  })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

describe('NotificationRepository: asking for nothing', () => {
  it('writes no rows when given none', async () => {
    expect(await notifications.insertMany([])).toBe(0)
  })

  it('marks nothing read for an empty list of ids', async () => {
    expect(await notifications.markRead({ userId: ADA, ids: [], now: NOW })).toBe(0)
  })
})

describe('NotificationRepository: a source that stopped syncing (ADR-061)', () => {
  const failed = (id: string, occurrence: string) => ({
    id,
    recipientUserId: ADA,
    kind: 'source-sync-failed' as const,
    workspaceId: WORKSPACE,
    failure: { reason: 'branch-not-found', revision: null },
    occurrence,
    createdAt: NOW,
  })

  it('writes a workspace row once per occurrence and reads it back', async () => {
    expect(await notifications.insertMany([failed('n-1', 'first')])).toBe(1)
    expect(await notifications.insertMany([failed('n-2', 'first')])).toBe(0)
    expect(await notifications.insertMany([failed('n-3', 'second')])).toBe(1)
    expect(await notifications.listForUser({ userId: ADA, after: null, limit: 10 })).toEqual([
      { ...failed('n-3', 'second'), readAt: null },
      { ...failed('n-1', 'first'), readAt: null },
    ])
    expect(await notifications.countUnread(ADA)).toBe(2)
  })

  it('refuses a row about nothing, as the table checks', async () => {
    await expect(
      database.pool.query(
        `INSERT INTO notifications (id, recipient_user_id, kind, created_at) VALUES ('bare', $1, 'source-sync-failed', now())`,
        [ADA],
      ),
    ).rejects.toThrow(/notifications_subject_check/)
  })

  it('leaves out rows this release cannot read rather than failing the list', async () => {
    for (const [id, kind, detail] of [
      ['unknown-kind', 'future-kind', null],
      ['unreadable-detail', 'source-sync-failed', '{"version":99}'],
      ['old-detail', 'source-sync-failed', '{"version":1,"reason":7}'],
    ] as const) {
      await database.pool.query(
        `INSERT INTO notifications (id, recipient_user_id, kind, workspace_id, occurrence, detail, created_at)
         VALUES ($1, $2, $3, $4, $1, $5, $6)`,
        [id, ADA, kind, WORKSPACE, detail, new Date(NOW.getTime() + 60_000)],
      )
    }
    const ids = (await notifications.listForUser({ userId: ADA, after: null, limit: 10 })).map(
      (row) => row.id,
    )
    expect(ids).not.toContain('unknown-kind')
    expect(ids).not.toContain('unreadable-detail')
    expect(ids).not.toContain('old-detail')
  })
})
