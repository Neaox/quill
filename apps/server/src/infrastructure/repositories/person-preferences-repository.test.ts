import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createPersonPreferencesRepository } from './person-preferences-repository.ts'
import { createUserRepository } from './user-repository.ts'

let database: TestDatabase
let preferences: ReturnType<typeof createPersonPreferencesRepository>
let users: ReturnType<typeof createUserRepository>

const PERSON = userId('00000000-0000-4000-8000-000000000001')
const NOW = new Date('2026-01-01T00:00:00.000Z')
const LATER = new Date('2026-02-01T00:00:00.000Z')

beforeAll(async () => {
  database = await createTestDatabase()
  preferences = createPersonPreferencesRepository(database.db)
  users = createUserRepository(database.db)
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM users')
  await users.create({ id: PERSON, email: 'ada@example.com', displayName: 'Ada', now: NOW })
})

describe('PersonPreferencesRepository', () => {
  it('is null for someone who has never saved any', async () => {
    expect(await preferences.find(PERSON)).toBeNull()
  })

  it('stores the document as written and finds it', async () => {
    const stored = await preferences.put({
      userId: PERSON,
      document: { version: 1, animatedImages: 'never' },
      now: NOW,
    })
    expect(stored).toEqual({
      userId: PERSON,
      document: { version: 1, animatedImages: 'never' },
      updatedAt: NOW,
    })
    expect(await preferences.find(PERSON)).toEqual(stored)
  })

  it('replaces the whole document on a second save', async () => {
    await preferences.put({
      userId: PERSON,
      document: { version: 1, animatedImages: 'never' },
      now: NOW,
    })
    await preferences.put({ userId: PERSON, document: { version: 1 }, now: LATER })
    expect(await preferences.find(PERSON)).toEqual({
      userId: PERSON,
      document: { version: 1 },
      updatedAt: LATER,
    })
  })

  it('goes with the person', async () => {
    await preferences.put({ userId: PERSON, document: { version: 1 }, now: NOW })
    await database.pool.query('DELETE FROM users')
    expect(await preferences.find(PERSON)).toBeNull()
  })
})
