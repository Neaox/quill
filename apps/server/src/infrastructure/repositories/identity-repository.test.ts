import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createIdentityRepository } from './identity-repository.ts'
import { createUserRepository } from './user-repository.ts'

/**
 * The identity table against the real schema, because the guarantee under
 * test is partly an index: `(issuer, subject)` is unique across the instance,
 * and the repository's job is to behave sensibly when two callers race for it.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const ISSUER = 'https://sso.example.com'
const ADA = userId('00000000-0000-4000-8000-000000000001')
const BOB = userId('00000000-0000-4000-8000-000000000002')

let database: TestDatabase
let identities: ReturnType<typeof createIdentityRepository>

beforeAll(async () => {
  database = await createTestDatabase()
  identities = createIdentityRepository(database.db)
  const users = createUserRepository(database.db)
  await users.create({ id: ADA, email: 'ada@example.com', displayName: 'Ada', now: NOW })
  await users.create({ id: BOB, email: 'bob@example.com', displayName: 'Bob', now: NOW })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM identities')
})

function link(id: string, user = ADA, subject = 'subject-1') {
  return identities.link({
    id,
    userId: user,
    providerId: 'entra',
    issuer: ISSUER,
    subject,
    now: NOW,
  })
}

describe('IdentityRepository', () => {
  it('links an identity and finds it by issuer and subject', async () => {
    const created = await link('identity-1')

    expect(created).toEqual({
      id: 'identity-1',
      userId: ADA,
      providerId: 'entra',
      issuer: ISSUER,
      subject: 'subject-1',
      createdAt: NOW,
      lastSignInAt: null,
    })
    expect(await identities.findBySubject(ISSUER, 'subject-1')).toEqual(created)
  })

  it('finds nothing for a subject at another issuer', async () => {
    await link('identity-1')

    expect(await identities.findBySubject('https://elsewhere.example', 'subject-1')).toBeNull()
    expect(await identities.findBySubject(ISSUER, 'somebody-else')).toBeNull()
  })

  it('hands the winner’s row to the loser of a race, rather than raising', async () => {
    const first = await link('identity-1')
    const second = await link('identity-2')

    expect(second).toEqual(first)
    const rows = await database.pool.query('SELECT * FROM identities')
    expect(rows.rowCount).toBe(1)
  })

  it('never moves an identity to another user, which is what the index is for', async () => {
    await link('identity-1', ADA)

    const again = await link('identity-2', BOB)

    expect(again.userId).toBe(ADA)
  })

  it('stamps the last sign-in', async () => {
    await link('identity-1')
    const later = new Date(NOW.getTime() + 60_000)

    await identities.touch('identity-1', later)

    expect(await identities.findBySubject(ISSUER, 'subject-1')).toMatchObject({
      lastSignInAt: later,
    })
  })

  it('lists what one person holds, oldest first, and nothing for anybody else', async () => {
    await link('identity-1', ADA, 'subject-1')
    await identities.link({
      id: 'identity-2',
      userId: ADA,
      providerId: 'google',
      issuer: 'https://accounts.google.com',
      subject: 'subject-2',
      now: new Date(NOW.getTime() + 1000),
    })

    expect((await identities.listForUser(ADA)).map((row) => row.providerId)).toEqual([
      'entra',
      'google',
    ])
    expect(await identities.listForUser(BOB)).toEqual([])
  })

  it('goes when the user does', async () => {
    await link('identity-1')

    await database.pool.query('DELETE FROM users WHERE id = $1', [ADA])

    expect(await identities.findBySubject(ISSUER, 'subject-1')).toBeNull()
    // Put the fixture back for whichever test runs next.
    await createUserRepository(database.db).create({
      id: ADA,
      email: 'ada@example.com',
      displayName: 'Ada',
      now: NOW,
    })
  })
})
