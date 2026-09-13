import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createMagicLinkRepository } from './magic-link-repository.ts'
import { createUserRepository } from './user-repository.ts'

let database: TestDatabase
let magicLinks: ReturnType<typeof createMagicLinkRepository>
const ALICE = userId('00000000-0000-4000-8000-000000000001')

beforeAll(async () => {
  database = await createTestDatabase()
  magicLinks = createMagicLinkRepository(database.db)
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
  await database.pool.query('DELETE FROM magic_link_tokens')
})

describe('MagicLinkRepository', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000)

  it('creates and finds a token by its hash', async () => {
    const created = await magicLinks.create({
      id: 'link-1',
      userId: ALICE,
      bindingHash: null,
      tokenHash: 'hash-1',
      purpose: 'sign-in',
      now,
      expiresAt,
    })
    expect(created).toEqual({
      id: 'link-1',
      userId: ALICE,
      bindingHash: null,
      tokenHash: 'hash-1',
      purpose: 'sign-in',
      expiresAt,
      consumedAt: null,
      createdAt: now,
    })
    expect(await magicLinks.findByTokenHash('hash-1')).toEqual(created)
  })

  it('returns null for an unknown hash', async () => {
    expect(await magicLinks.findByTokenHash('nope')).toBeNull()
  })

  it('consumes a token exactly once', async () => {
    await magicLinks.create({
      id: 'link-1',
      userId: ALICE,
      bindingHash: null,
      tokenHash: 'hash-1',
      purpose: 'sign-in',
      now,
      expiresAt,
    })
    expect(await magicLinks.consume('link-1', now)).toBe(true)
    expect((await magicLinks.findByTokenHash('hash-1'))?.consumedAt).toEqual(now)
    expect(await magicLinks.consume('link-1', now)).toBe(false)
  })

  it('reports false when consuming a token that does not exist', async () => {
    expect(await magicLinks.consume('nope', now)).toBe(false)
  })
})

/** Review finding M15: a spent or expired token is a hash of a credential kept for nothing. */
describe('deleteSpent', () => {
  it('removes consumed and expired tokens, and keeps a live one', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const later = new Date(now.getTime() + 15 * 60_000)
    await magicLinks.create({
      id: 'expired',
      userId: ALICE,
      tokenHash: 'hash-expired',
      purpose: 'sign-in',
      now,
      expiresAt: new Date(now.getTime() - 60_000),
    })
    await magicLinks.create({
      id: 'spent',
      userId: ALICE,
      tokenHash: 'hash-spent',
      purpose: 'sign-in',
      now,
      expiresAt: later,
    })
    await magicLinks.consume('spent', now)
    await magicLinks.create({
      id: 'live',
      userId: ALICE,
      tokenHash: 'hash-live',
      purpose: 'sign-in',
      now,
      expiresAt: later,
    })

    expect(await magicLinks.deleteSpent(now)).toBe(2)
    expect(await magicLinks.findByTokenHash('hash-live')).not.toBeNull()
    expect(await magicLinks.findByTokenHash('hash-spent')).toBeNull()
    expect(await magicLinks.findByTokenHash('hash-expired')).toBeNull()
  })
})
