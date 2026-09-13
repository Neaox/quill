import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createSessionRepository } from './session-repository.ts'
import { createUserRepository } from './user-repository.ts'

let database: TestDatabase
let sessions: ReturnType<typeof createSessionRepository>
const ALICE = userId('00000000-0000-4000-8000-000000000001')
const BOB = userId('00000000-0000-4000-8000-000000000002')

beforeAll(async () => {
  database = await createTestDatabase()
  sessions = createSessionRepository(database.db)
  const users = createUserRepository(database.db)
  const now = new Date('2026-01-01T00:00:00.000Z')
  await users.create({ id: ALICE, email: 'ada@example.com', displayName: 'Ada', now })
  await users.create({ id: BOB, email: 'bob@example.com', displayName: 'Bob', now })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM sessions')
})

describe('SessionRepository', () => {
  it('creates a session and finds it by id and by token hash', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const expiresAt = new Date('2026-02-01T00:00:00.000Z')
    const created = await sessions.create({
      id: 'session-1',
      userId: ALICE,
      tokenHash: 'hash-1',
      now,
      expiresAt,
    })
    expect(created).toEqual({
      id: 'session-1',
      userId: ALICE,
      tokenHash: 'hash-1',
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    expect(await sessions.findById('session-1')).toEqual(created)
    expect(await sessions.findByTokenHash('hash-1')).toEqual(created)
  })

  it('returns null for an unknown session, by either key', async () => {
    expect(await sessions.findById('nope')).toBeNull()
    expect(await sessions.findByTokenHash('nope')).toBeNull()
  })

  it('stamps last_seen_at, which is what the idle timeout measures from', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const later = new Date('2026-01-01T01:00:00.000Z')
    await sessions.create({
      id: 'session-1',
      userId: ALICE,
      tokenHash: 'hash-1',
      now,
      expiresAt: later,
    })
    await sessions.touch('session-1', later)
    expect((await sessions.findById('session-1'))?.lastSeenAt).toEqual(later)
  })

  it('lists a user’s sessions newest first', async () => {
    const first = new Date('2026-01-01T00:00:00.000Z')
    const second = new Date('2026-01-02T00:00:00.000Z')
    await sessions.create({
      id: 'alice-1',
      userId: ALICE,
      tokenHash: 'hash-1',
      now: first,
      expiresAt: second,
    })
    await sessions.create({
      id: 'alice-2',
      userId: ALICE,
      tokenHash: 'hash-2',
      now: second,
      expiresAt: second,
    })
    await sessions.create({
      id: 'bob-1',
      userId: BOB,
      tokenHash: 'hash-3',
      now: second,
      expiresAt: second,
    })

    expect((await sessions.listForUser(ALICE)).map((row) => row.id)).toEqual(['alice-2', 'alice-1'])
  })

  it('deletes a single session', async () => {
    const now = new Date()
    await sessions.create({
      id: 'session-1',
      userId: ALICE,
      tokenHash: 'hash-1',
      now,
      expiresAt: now,
    })
    await sessions.delete('session-1')
    expect(await sessions.findById('session-1')).toBeNull()
  })

  it('deletes every session for a user without touching another user', async () => {
    const now = new Date()
    await create('alice-1', ALICE)
    await create('alice-2', ALICE)
    await create('bob-1', BOB)

    await sessions.deleteAllForUser(ALICE)

    expect(await sessions.findById('alice-1')).toBeNull()
    expect(await sessions.findById('alice-2')).toBeNull()
    expect(await sessions.findById('bob-1')).not.toBeNull()

    async function create(id: string, user: typeof ALICE): Promise<void> {
      await sessions.create({ id, userId: user, tokenHash: `hash-${id}`, now, expiresAt: now })
    }
  })

  it('keeps one session when signing out everywhere else', async () => {
    const now = new Date()
    for (const id of ['alice-1', 'alice-2', 'alice-3']) {
      await sessions.create({ id, userId: ALICE, tokenHash: `hash-${id}`, now, expiresAt: now })
    }

    await sessions.deleteAllForUserExcept(ALICE, 'alice-2')

    expect((await sessions.listForUser(ALICE)).map((row) => row.id)).toEqual(['alice-2'])
  })
})

/**
 * Review finding M15. `authenticate` deletes a session it finds past a clock,
 * but only one somebody presents; a row nobody comes back to is never read
 * again and would otherwise sit there for the life of the instance.
 */
const DAY_MS = 24 * 60 * 60 * 1000

function days(count: number): number {
  return count * DAY_MS
}

describe('deleteExpired', () => {
  const t0 = new Date('2026-03-01T00:00:00.000Z')

  async function session(id: string, createdAt: Date, expiresAt: Date): Promise<void> {
    await sessions.create({ id, userId: ALICE, tokenHash: `hash-${id}`, now: createdAt, expiresAt })
  }

  it('removes sessions past either clock and keeps the live ones', async () => {
    await session('absolute', new Date(t0.getTime() - days(40)), new Date(t0.getTime() - days(1)))
    await session('idle', new Date(t0.getTime() - days(20)), new Date(t0.getTime() + days(10)))
    await sessions.touch('idle', new Date(t0.getTime() - days(21)))
    await session('live', t0, new Date(t0.getTime() + days(30)))

    const removed = await sessions.deleteExpired({
      now: t0,
      idleCutoff: new Date(t0.getTime() - days(7)),
    })
    expect(removed).toBe(2)
    expect(await sessions.findById('live')).not.toBeNull()
    expect(await sessions.findById('absolute')).toBeNull()
    expect(await sessions.findById('idle')).toBeNull()
  })

  /** A row written before `last_seen_at` existed measures idleness from creation (ADR-033). */
  it('falls back to created_at for a row with no last_seen_at', async () => {
    await session('legacy', new Date(t0.getTime() - days(30)), new Date(t0.getTime() + days(10)))
    await database.pool.query('UPDATE sessions SET last_seen_at = NULL WHERE id = $1', ['legacy'])

    expect(
      await sessions.deleteExpired({ now: t0, idleCutoff: new Date(t0.getTime() - days(7)) }),
    ).toBe(1)
    expect(await sessions.findById('legacy')).toBeNull()
  })
})
