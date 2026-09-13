import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createCredentialRepository } from './credential-repository.ts'
import { createUserRepository } from './user-repository.ts'

let database: TestDatabase
let credentials: ReturnType<typeof createCredentialRepository>
const ALICE = userId('00000000-0000-4000-8000-000000000001')

beforeAll(async () => {
  database = await createTestDatabase()
  credentials = createCredentialRepository(database.db)
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
  await database.pool.query('DELETE FROM password_credentials')
})

describe('CredentialRepository', () => {
  it('returns null when no credential exists', async () => {
    expect(await credentials.findByUserId(ALICE)).toBeNull()
  })

  it('upserts and reads back a credential', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    await credentials.upsert({ userId: ALICE, passwordHash: 'hash-1', now })
    expect(await credentials.findByUserId(ALICE)).toEqual({
      userId: ALICE,
      passwordHash: 'hash-1',
      updatedAt: now,
    })

    const later = new Date('2026-01-02T00:00:00.000Z')
    await credentials.upsert({ userId: ALICE, passwordHash: 'hash-2', now: later })
    expect(await credentials.findByUserId(ALICE)).toEqual({
      userId: ALICE,
      passwordHash: 'hash-2',
      updatedAt: later,
    })
  })

  it('deletes a credential', async () => {
    await credentials.upsert({ userId: ALICE, passwordHash: 'hash-1', now: new Date() })
    await credentials.delete(ALICE)
    expect(await credentials.findByUserId(ALICE)).toBeNull()
  })
})
