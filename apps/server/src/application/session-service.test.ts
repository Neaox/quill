import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { hashSessionToken } from '../auth/session-token.ts'
import { createTestDatabase, type TestDatabase } from '../infrastructure/db/test-database.ts'
import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createUserRepository } from '../infrastructure/repositories/user-repository.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createSessionService } from './session-service.ts'

/**
 * The session clocks, against a real database, because the thing under test
 * is partly a column: a row written before `last_seen_at` existed has none,
 * and the idle timeout still has to mean something for it (ADR-033's
 * expand-only migrations).
 */

const CONFIG = {
  cookieName: 'quill_session',
  linkCookieName: 'quill_link',
  oidcCookieName: 'quill_oidc',
  ttlMs: 600_000,
  idleTtlMs: 300_000,
  secureCookie: false,
}
const ADA = userId('00000000-0000-4000-8000-000000000001')
const BOB = userId('00000000-0000-4000-8000-000000000002')
const START = new Date('2026-01-01T00:00:00.000Z')

let database: TestDatabase
let uow: ReturnType<typeof createUnitOfWork>

beforeAll(async () => {
  database = await createTestDatabase()
  uow = createUnitOfWork(database.db, database.pool, createFakeIdGenerator())
  const users = createUserRepository(database.db)
  await users.create({ id: ADA, email: 'ada@example.com', displayName: 'Ada', now: START })
  await users.create({ id: BOB, email: 'bob@example.com', displayName: 'Bob', now: START })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM sessions')
})

function setUp() {
  const clock = createFakeClock(START)
  const service = createSessionService({
    uow,
    clock,
    ids: createFakeIdGenerator(),
    session: CONFIG,
  })
  return { clock, service }
}

describe('issue', () => {
  it('mints a token, stores only its hash, and sets the absolute deadline', async () => {
    const { service, clock } = setUp()
    const { token, session } = await service.issue(ADA)

    expect(session.tokenHash).toBe(hashSessionToken(token))
    expect(session.tokenHash).not.toBe(token)
    expect(session.expiresAt).toEqual(new Date(clock.now().getTime() + CONFIG.ttlMs))
    expect(session.lastSeenAt).toEqual(clock.now())
  })
})

describe('rotate', () => {
  it('issues a new session and drops the old one', async () => {
    const { service } = setUp()
    const first = await service.issue(ADA)
    const second = await service.rotate(ADA, first.session.id)

    expect(second.session.id).not.toBe(first.session.id)
    expect(await service.authenticate(first.token)).toEqual({ ok: false, reason: 'unknown' })
    expect((await service.authenticate(second.token)).ok).toBe(true)
  })

  it('issues without dropping anything when there is no previous session', async () => {
    const { service } = setUp()
    const issued = await service.rotate(ADA, null)
    expect((await service.authenticate(issued.token)).ok).toBe(true)
  })
})

describe('authenticate', () => {
  it('accepts a live token and reports the row', async () => {
    const { service } = setUp()
    const { token, session } = await service.issue(ADA)
    const result = await service.authenticate(token)
    expect(result).toEqual({ ok: true, session: expect.objectContaining({ id: session.id }) })
  })

  it('rejects a token that matches nothing', async () => {
    const { service } = setUp()
    expect(await service.authenticate('not a token')).toEqual({ ok: false, reason: 'unknown' })
  })

  it('rejects and deletes a session past its absolute deadline', async () => {
    const { service, clock } = setUp()
    const { token, session } = await service.issue(ADA)
    clock.advance(CONFIG.ttlMs + 1)

    expect(await service.authenticate(token)).toEqual({ ok: false, reason: 'expired' })
    expect(await uow.repos.sessions.findById(session.id)).toBeNull()
  })

  it('rejects a session past its idle deadline', async () => {
    const { service, clock } = setUp()
    const { token } = await service.issue(ADA)
    clock.advance(CONFIG.idleTtlMs + 1)
    expect(await service.authenticate(token)).toEqual({ ok: false, reason: 'expired' })
  })

  /** ADR-033: the column was added by an expand-only migration, so it can be null. */
  it('measures the idle window from created_at when last_seen_at was never written', async () => {
    const { service, clock } = setUp()
    const { token, session } = await service.issue(ADA)
    await database.pool.query('UPDATE sessions SET last_seen_at = NULL WHERE id = $1', [session.id])

    clock.advance(CONFIG.idleTtlMs - 1_000)
    const accepted = await service.authenticate(token)
    expect(accepted.ok).toBe(true)
    // Reaching it also repaired the row, so the next request measures from now.
    expect((await uow.repos.sessions.findById(session.id))?.lastSeenAt).toEqual(clock.now())

    clock.advance(CONFIG.idleTtlMs + 1)
    expect(await service.authenticate(token)).toEqual({ ok: false, reason: 'expired' })
  })
})

describe('list and revoke', () => {
  it('lists one user’s sessions', async () => {
    const { service } = setUp()
    await service.issue(ADA)
    await service.issue(ADA)
    await service.issue(BOB)
    expect(await service.list(ADA)).toHaveLength(2)
  })

  it('revokes one session', async () => {
    const { service } = setUp()
    const { token, session } = await service.issue(ADA)
    await service.revoke(session.id)
    expect(await service.authenticate(token)).toEqual({ ok: false, reason: 'unknown' })
  })

  it('revokes everything, or everything but one', async () => {
    const { service } = setUp()
    const kept = await service.issue(ADA)
    await service.issue(ADA)
    await service.issue(BOB)

    await service.revokeAll(ADA, kept.session.id)
    expect((await service.list(ADA)).map((row) => row.id)).toEqual([kept.session.id])
    expect(await service.list(BOB)).toHaveLength(1)

    await service.revokeAll(ADA, null)
    expect(await service.list(ADA)).toEqual([])
    expect(await service.list(BOB)).toHaveLength(1)
  })
})
