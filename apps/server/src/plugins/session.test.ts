import fastifyCookie from '@fastify/cookie'
import fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'

import { generateSessionToken, hashSessionToken } from '../auth/session-token.ts'
import { createTestDatabase, type TestDatabase } from '../infrastructure/db/test-database.ts'
import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createUserRepository } from '../infrastructure/repositories/user-repository.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { registerErrorHandler } from './error-handler.ts'
import { registerSessionSupport } from './session.ts'

// Ten minutes absolute, five idle: long enough that a stamp (written at
// most once a minute) has room to matter, short enough to reach with the
// fake clock.
const SESSION_CONFIG = {
  cookieName: 'quill_session',
  linkCookieName: 'quill_link',
  oidcCookieName: 'quill_oidc',
  ttlMs: 600_000,
  idleTtlMs: 300_000,
  secureCookie: false,
}
const ALICE = userId('00000000-0000-4000-8000-000000000001')
const UNVERIFIED = userId('00000000-0000-4000-8000-000000000002')
const START = new Date('2026-01-01T00:00:00.000Z')

let database: TestDatabase
let uow: ReturnType<typeof createUnitOfWork>

beforeAll(async () => {
  database = await createTestDatabase()
  uow = createUnitOfWork(database.db, database.pool, createFakeIdGenerator())
  const users = createUserRepository(database.db)
  await users.create({ id: ALICE, email: 'ada@example.com', displayName: 'Ada', now: START })
  await users.markEmailVerified(ALICE, START)
  await users.create({
    id: UNVERIFIED,
    email: 'new@example.com',
    displayName: 'New',
    now: START,
  })
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM sessions')
})

function buildTestApp(clock: ReturnType<typeof createFakeClock>) {
  const app = fastify({ logger: false })
  app.register(fastifyCookie)
  registerErrorHandler(app)
  registerSessionSupport(app, {
    uow,
    clock,
    ids: createFakeIdGenerator(),
    session: SESSION_CONFIG,
  })
  app.get('/protected', { preHandler: app.requireSession }, async (request) => ({
    userId: request.session?.userId,
  }))
  app.get('/verified', { preHandler: app.requireVerifiedSession }, async (request) => ({
    userId: request.session?.userId,
  }))
  return app
}

/** Creates a session the way the server does: token in the cookie, hash in the row. */
async function issue(
  clock: ReturnType<typeof createFakeClock>,
  user = ALICE,
  id = 'session-1',
): Promise<string> {
  const token = generateSessionToken()
  await uow.repos.sessions.create({
    id,
    userId: user,
    tokenHash: hashSessionToken(token),
    now: clock.now(),
    expiresAt: new Date(clock.now().getTime() + SESSION_CONFIG.ttlMs),
  })
  return token
}

describe('registerSessionSupport', () => {
  it('rejects a request with no session cookie', async () => {
    const app = buildTestApp(createFakeClock(START))
    const response = await app.inject({ method: 'GET', url: '/protected' })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('unauthenticated')
    await app.close()
  })

  it('rejects a token that matches no session', async () => {
    const app = buildTestApp(createFakeClock(START))
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { quill_session: 'nope' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('unauthenticated')
    await app.close()
  })

  it('populates request.session for a valid session', async () => {
    const clock = createFakeClock(START)
    const token = await issue(clock)

    const app = buildTestApp(clock)
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { quill_session: token },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ userId: ALICE })
    await app.close()
  })

  it('never stores the value the cookie carries', async () => {
    const clock = createFakeClock(START)
    const token = await issue(clock)
    const row = await uow.repos.sessions.findById('session-1')
    expect(row?.tokenHash).not.toBe(token)
    expect(row?.tokenHash).toBe(hashSessionToken(token))
  })

  it('rejects an absolutely expired session with session_expired, and deletes it', async () => {
    const clock = createFakeClock(START)
    const token = await issue(clock)
    clock.advance(SESSION_CONFIG.ttlMs + 1)

    const app = buildTestApp(clock)
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { quill_session: token },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('session_expired')
    expect(await uow.repos.sessions.findById('session-1')).toBeNull()
    await app.close()
  })

  it('rejects an idle session even though its absolute lifetime has not run out', async () => {
    const clock = createFakeClock(START)
    const token = await issue(clock)
    // Past the idle window, well inside the absolute one.
    clock.advance(SESSION_CONFIG.idleTtlMs + 1)

    const app = buildTestApp(clock)
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { quill_session: token },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('session_expired')
    await app.close()
  })

  it('stamps last_seen_at so activity keeps a session alive', async () => {
    const clock = createFakeClock(START)
    const token = await issue(clock)
    const app = buildTestApp(clock)

    // Two requests, each within the idle window, spanning more than one
    // window in total: the second must still be accepted.
    clock.advance(SESSION_CONFIG.idleTtlMs - 60_000)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/protected',
          cookies: { quill_session: token },
        })
      ).statusCode,
    ).toBe(200)
    expect((await uow.repos.sessions.findById('session-1'))?.lastSeenAt).toEqual(clock.now())

    clock.advance(SESSION_CONFIG.idleTtlMs - 60_000)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/protected',
          cookies: { quill_session: token },
        })
      ).statusCode,
    ).toBe(200)
    await app.close()
  })

  it('does not write on every request: a stamp a few seconds old is left alone', async () => {
    const clock = createFakeClock(START)
    const token = await issue(clock)
    const app = buildTestApp(clock)

    clock.advance(1_000)
    await app.inject({ method: 'GET', url: '/protected', cookies: { quill_session: token } })
    expect((await uow.repos.sessions.findById('session-1'))?.lastSeenAt).toEqual(START)
    await app.close()
  })

  describe('requireVerifiedSession', () => {
    it('lets a verified user through', async () => {
      const clock = createFakeClock(START)
      const token = await issue(clock)
      const app = buildTestApp(clock)
      const response = await app.inject({
        method: 'GET',
        url: '/verified',
        cookies: { quill_session: token },
      })
      expect(response.statusCode).toBe(200)
      await app.close()
    })

    it('refuses an unverified user with email_not_verified', async () => {
      const clock = createFakeClock(START)
      const token = await issue(clock, UNVERIFIED, 'session-2')
      const app = buildTestApp(clock)
      const response = await app.inject({
        method: 'GET',
        url: '/verified',
        cookies: { quill_session: token },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('email_not_verified')
      await app.close()
    })

    it('still requires a session at all', async () => {
      const app = buildTestApp(createFakeClock(START))
      expect((await app.inject({ method: 'GET', url: '/verified' })).statusCode).toBe(401)
      await app.close()
    })
  })
})
