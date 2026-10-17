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

  describe('the people directory', () => {
    async function person(n: number, email: string, displayName: string, verified = true) {
      const id = userId(`00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`)
      await users.create({ id, email, displayName, now: NOW })
      if (verified) await users.markEmailVerified(id, NOW)
      return id
    }

    it('names many verified addresses in one query, whatever their case', async () => {
      await person(1, 'ada@example.com', 'Ada Lovelace')
      await person(2, 'grace@example.com', 'Grace Hopper')
      await person(3, 'mallory@example.com', 'Mallory', false)
      const found = await users.findVerifiedByEmails([
        'ADA@example.com',
        'grace@example.com',
        'mallory@example.com',
        'nobody@example.com',
      ])
      expect(found.map((user) => user.displayName).toSorted()).toEqual([
        'Ada Lovelace',
        'Grace Hopper',
      ])
      expect(await users.findVerifiedByEmails([])).toEqual([])
    })

    it('searches verified people by name or address, by name, a few at a time', async () => {
      await person(1, 'ada@example.com', 'Ada Lovelace')
      await person(2, 'grace@example.com', 'Grace Hopper')
      await person(3, 'hop@example.com', 'Unverified Hopper', false)
      await person(4, '100%_sure@example.com', 'Percy')
      expect((await users.searchVerified('hop', 8)).map((user) => user.displayName)).toEqual([
        'Grace Hopper',
      ])
      expect((await users.searchVerified('EXAMPLE', 2)).map((user) => user.displayName)).toEqual([
        'Ada Lovelace',
        'Grace Hopper',
      ])
      // What was typed is matched literally, never as a pattern.
      expect((await users.searchVerified('%_', 8)).map((user) => user.displayName)).toEqual([
        'Percy',
      ])
      expect(await users.searchVerified('_', 8)).toHaveLength(1)
    })
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
