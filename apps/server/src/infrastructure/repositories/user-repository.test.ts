import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createUserRepository } from './user-repository.ts'

let database: TestDatabase
let users: ReturnType<typeof createUserRepository>

beforeAll(async () => {
  database = await createTestDatabase()
  users = createUserRepository(database.db)
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM users')
})

describe('UserRepository', () => {
  const NOW = new Date('2026-01-01T00:00:00.000Z')

  it('creates and finds a user by id and by email', async () => {
    const id = userId('00000000-0000-4000-8000-000000000001')
    const created = await users.create({
      id,
      email: 'ada@example.com',
      displayName: 'Ada',
      now: NOW,
    })
    expect(created).toEqual({
      id,
      email: 'ada@example.com',
      displayName: 'Ada',
      emailVerifiedAt: null,
      isInstanceAdmin: false,
      createdAt: NOW,
    })

    expect(await users.findById(id)).toEqual(created)
    expect(await users.findByEmail('ada@example.com')).toEqual(created)
  })

  it('returns null for an unknown id or email', async () => {
    expect(await users.findById(userId('00000000-0000-4000-8000-000000000099'))).toBeNull()
    expect(await users.findByEmail('nobody@example.com')).toBeNull()
  })

  it('marks a user email verified', async () => {
    const id = userId('00000000-0000-4000-8000-000000000002')
    await users.create({ id, email: 'bob@example.com', displayName: 'Bob', now: NOW })
    const verifiedAt = new Date('2026-01-02T00:00:00.000Z')
    await users.markEmailVerified(id, verifiedAt)
    expect((await users.findById(id))?.emailVerifiedAt).toEqual(verifiedAt)
  })

  it('sets and unsets instance admin', async () => {
    const id = userId('00000000-0000-4000-8000-000000000003')
    await users.create({ id, email: 'carol@example.com', displayName: 'Carol', now: NOW })
    await users.setInstanceAdmin(id, true)
    expect((await users.findById(id))?.isInstanceAdmin).toBe(true)
    await users.setInstanceAdmin(id, false)
    expect((await users.findById(id))?.isInstanceAdmin).toBe(false)
  })
})
