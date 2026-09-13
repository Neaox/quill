import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../app.ts'
import { createPasswordHasher } from '../auth/password.ts'
import { createIdentityProviderRegistry, outboundClientFactory } from '../auth/oidc/registry.ts'
import type { SecretResolver } from '../infrastructure/secrets/resolve-secret.ts'
import { createRateLimiter } from '../auth/rate-limit.ts'
import { createTokenService } from '../auth/tokens.ts'
import { MAIL_REQUESTED } from '@quill/application'

import { hashSessionToken } from '../auth/session-token.ts'
import { createSendMailConsumer } from '../infrastructure/outbox/send-mail.ts'
import { pollOutboxOnce } from '../infrastructure/outbox/poller.ts'
import { createHasher } from '../infrastructure/hasher.ts'
import { createDocumentFormat } from '../infrastructure/markdown/document-format.ts'
import { loadConfig } from '../config.ts'
import type { AppDependencies } from '../dependencies.ts'
import { createTestDatabase, type TestDatabase } from '../infrastructure/db/test-database.ts'
import { createSearchService } from '@quill/search'
import { createInMemorySearchIndex } from '@quill/search/test-support'

import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { injectAsBrowser } from '../test-support/browser-client.ts'
import {
  createFakeBreachedPasswordChecker,
  createFakeClock,
  createFakeIdGenerator,
  createInMemoryBlobStore,
  createRecordingMailer,
  inMemorySettings,
} from '../test-support/fakes.ts'
import type { FakeBreachedPasswordChecker, FakeClock } from '../test-support/fakes.ts'

/** Nothing in these tests searches; the engine is present because `AppDependencies` is one shape. */
const SEARCH_INDEX = createInMemorySearchIndex()

/** No test in this file configures a provider, so nothing here ever resolves a secret. */
const UNUSED_SECRET_RESOLVER: SecretResolver = {
  /* v8 ignore next 3 */
  async resolve() {
    throw new Error('not exercised: no OIDC provider is configured in this file')
  },
}

let database: TestDatabase
let app: FastifyInstance
let deps: AppDependencies
let clock: FakeClock
let breachedPasswords: FakeBreachedPasswordChecker

const PASSWORD = 'correct horse battery'
const RATE_LIMIT = { max: 3, windowMs: 1_000, maxWindowMs: 8_000 }

beforeAll(async () => {
  database = await createTestDatabase()
  clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
  breachedPasswords = createFakeBreachedPasswordChecker()
  const config = {
    ...loadConfig({ CONTENT_STORE: 'memory' }),
    rateLimit: RATE_LIMIT,
  }
  deps = {
    uow: createUnitOfWork(database.db, database.pool, createFakeIdGenerator()),
    clock,
    ids: createFakeIdGenerator(),
    hasher: createHasher(),
    tokens: createTokenService(),
    shareLinkPolicy: { allowed: () => true },
    ...(await inMemorySettings(clock, config)),
    blobStore: createInMemoryBlobStore(),
    format: createDocumentFormat(),
    searchIndex: SEARCH_INDEX,
    search: createSearchService(SEARCH_INDEX),
    mailer: createRecordingMailer(),
    breachedPasswords,
    rateLimiter: createRateLimiter({ clock, config: RATE_LIMIT }),
    oidcRateLimiter: createRateLimiter({ clock, config: config.oidcRateLimit }),
    attachmentRateLimiter: createRateLimiter({ clock, config: config.attachments.rateLimit }),
    // The real Argon2id here: this file is the end-to-end journey, and the
    // dummy hash it builds at startup is part of what is being closed.
    passwords: await createPasswordHasher(),
    identityProviders: createIdentityProviderRegistry({
      providers: config.oidcProviders,
      appUrl: config.appUrl,
      createClient: outboundClientFactory,
      clock,
      secretResolver: UNUSED_SECRET_RESOLVER,
    }),
    config,
  }
  app = buildApp({ logLevel: 'silent', deps, serveApiDocs: false })
  injectAsBrowser(app)
  await app.ready()
}, 30_000)

afterAll(async () => {
  await app.close()
  await database.drop()
})

beforeEach(async () => {
  for (const table of [
    'audit_events',
    'sessions',
    'magic_link_tokens',
    'password_credentials',
    'users',
  ]) {
    await database.pool.query(`DELETE FROM ${table}`)
  }
  await database.pool.query('DELETE FROM outbox_events')
  const mailer = deps.mailer as ReturnType<typeof createRecordingMailer>
  mailer.sent.length = 0
  mailer.accountExists.length = 0
  advanceOutOfEveryWindow()
})

/**
 * The limiter lives for the whole file, so each test starts by moving the
 * fake clock past the longest window there can be: every key's count is
 * then back to zero, whatever the last test spent.
 */
function advanceOutOfEveryWindow(): void {
  clock.advance(RATE_LIMIT.maxWindowMs * 2)
}

function sessionCookieFrom(response: {
  cookies: readonly { name: string; value: string }[]
}): string {
  const cookie = response.cookies.find((c) => c.name === deps.config.session.cookieName)
  if (cookie === undefined) throw new Error('expected a session cookie in the response')
  return cookie.value
}

function cookies(token: string): Record<string, string> {
  return { [deps.config.session.cookieName]: token }
}

const mailer = (): ReturnType<typeof createRecordingMailer> =>
  deps.mailer as ReturnType<typeof createRecordingMailer>

/**
 * Mail is queued, not sent, so that a request costs the same whether or not
 * the address has an account (ADR-011, review finding H3). Running the
 * consumer is what a test does instead of waiting for the job runner.
 */
async function deliverMail(): Promise<void> {
  await pollOutboxOnce(
    database.pool,
    new Map([[MAIL_REQUESTED, createSendMailConsumer(deps.mailer)]]),
    { now: clock.now() },
  )
}

/**
 * The token from the most recently delivered link.
 *
 * It arrives in the URL *fragment*, which never reaches any server (review
 * finding M2): the web app reads it in the browser and posts it back.
 */
function latestToken(index = -1): string {
  const sent = mailer().sent
  const url = sent.at(index)?.url ?? ''
  return new URLSearchParams(new URL(url).hash.slice(1)).get('token') ?? ''
}

/**
 * The "you asked for this link here" cookie a link request leaves behind.
 * Consuming a link needs it, or an explicit confirmation (ADR-011).
 */
function linkCookieFrom(response: {
  cookies: readonly { name: string; value: string }[]
}): Record<string, string> {
  const cookie = response.cookies.find((c) => c.name === deps.config.session.linkCookieName)
  if (cookie === undefined) throw new Error('expected a link cookie in the response')
  return { [cookie.name]: cookie.value }
}

async function signUp(email = 'ada@example.com', password = PASSWORD) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-up',
    payload: { email, password, displayName: 'Ada' },
  })
}

async function signIn(email = 'ada@example.com', password = PASSWORD) {
  return app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email, password } })
}

describe('auth routes', () => {
  it('signs up, then signs in, and reads /api/me with the session cookie', async () => {
    expect((await signUp()).statusCode).toBe(202)

    const signedIn = await signIn()
    expect(signedIn.statusCode).toBe(200)

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: cookies(sessionCookieFrom(signedIn)),
    })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({
      email: 'ada@example.com',
      displayName: 'Ada',
      emailVerified: false,
    })
  })

  /** Review finding 2: a database read must not yield a usable cookie. */
  it('stores a hash of the session token, never the token itself', async () => {
    await signUp()
    const signedIn = await signIn()
    const token = sessionCookieFrom(signedIn)

    const { rows } = await database.pool.query<{ id: string; token_hash: string }>(
      'SELECT id, token_hash FROM sessions',
    )
    expect(rows).toHaveLength(1)
    for (const value of Object.values(rows[0] ?? {})) {
      expect(value).not.toBe(token)
    }
    expect(rows[0]?.token_hash).toBe(hashSessionToken(token))

    // And the cookie still works.
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', cookies: cookies(token) })).statusCode,
    ).toBe(200)
  })

  it('sets an httpOnly, SameSite=Lax, Path=/ cookie with no Domain', async () => {
    await signUp()
    const signedIn = await signIn()
    const cookie = signedIn.cookies.find((c) => c.name === deps.config.session.cookieName)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
    expect(cookie?.['path']).toBe('/')
    expect(cookie?.['domain']).toBeUndefined()
  })

  /** Review finding 4. */
  describe('no account enumeration', () => {
    it('answers sign-up identically for a new and an existing email', async () => {
      const first = await signUp()
      const second = await signUp()

      expect(second.statusCode).toBe(first.statusCode)
      expect(second.json()).toEqual(first.json())
      // Both left the same cookie, so the response says nothing either.
      expect(linkCookieFrom(second)).not.toEqual(linkCookieFrom(first))
      expect(Object.keys(linkCookieFrom(second))).toEqual(Object.keys(linkCookieFrom(first)))

      // The owner of the address is told out of band, once the queued mail
      // is delivered.
      await deliverMail()
      expect(mailer().accountExists.map((mail) => mail.to)).toEqual(['ada@example.com'])
    })

    it('answers sign-in identically for a missing account and a wrong password', async () => {
      await signUp()
      const wrongPassword = await signIn('ada@example.com', 'not the password')
      const noAccount = await signIn('nobody@example.com', 'not the password')

      expect(noAccount.statusCode).toBe(wrongPassword.statusCode)
      expect(noAccount.json()).toEqual(wrongPassword.json())
    })

    it('answers the magic-link and reset requests identically either way', async () => {
      await signUp()
      const known = await app.inject({
        method: 'POST',
        url: '/api/auth/magic-link',
        payload: { email: 'ada@example.com', purpose: 'password-reset' },
      })
      const unknown = await app.inject({
        method: 'POST',
        url: '/api/auth/magic-link',
        payload: { email: 'nobody@example.com', purpose: 'password-reset' },
      })
      expect(unknown.statusCode).toBe(known.statusCode)
      expect(unknown.json()).toEqual(known.json())

      const knownReset = await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset/request',
        payload: { email: 'ada@example.com' },
      })
      const unknownReset = await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset/request',
        payload: { email: 'nobody@example.com' },
      })
      expect(unknownReset.statusCode).toBe(knownReset.statusCode)
      expect(unknownReset.json()).toEqual(knownReset.json())
    })
  })

  /** Review finding 8: 8-and-unbounded was both too weak and a hashing DoS. */
  describe('password policy', () => {
    it('rejects anything under twelve characters', async () => {
      const response = await signUp('short@example.com', 'elevenchars')
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('validation_error')
    })

    it('rejects anything over 128 characters', async () => {
      const response = await signUp('long@example.com', 'x'.repeat(129))
      expect(response.statusCode).toBe(400)
    })

    it('accepts any Unicode at twelve characters or more', async () => {
      expect((await signUp('emoji@example.com', '🐈‍⬛ ταὐτὰ πάσχειν')).statusCode).toBe(202)
    })
  })

  it('refuses a breached password without saying anything about the account', async () => {
    breachedPasswords.breach('breachedpassword', 12_345)
    const response = await signUp('ada@example.com', 'breachedpassword')
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('breached_password')
    expect(response.json().error.message).not.toContain('ada@example.com')
  })

  it('rejects sign-in with the wrong password', async () => {
    await signUp()
    const response = await signIn('ada@example.com', 'wrong but long enough')
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('invalid_credentials')
  })

  it('rejects /api/me with no session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401)
  })

  it('signs out and clears the cookie', async () => {
    await signUp()
    const token = sessionCookieFrom(await signIn())

    const signOut = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      cookies: cookies(token),
    })
    expect(signOut.statusCode).toBe(204)
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', cookies: cookies(token) })).statusCode,
    ).toBe(401)
  })

  it('signs out cleanly with no session cookie, and with an unknown one', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/sign-out' })).statusCode).toBe(204)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/sign-out',
          cookies: cookies('not a real token'),
        })
      ).statusCode,
    ).toBe(204)
  })

  it('completes the magic-link sign-in flow end to end', async () => {
    // A magic link reaches an account that exists; it no longer creates one
    // (review finding M7), so the account comes from sign-up.
    await signUp('new@example.com')
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'new@example.com' },
    })
    expect(request.statusCode).toBe(202)
    await deliverMail()
    const inThisBrowser = linkCookieFrom(request)

    const consume = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/consume',
      payload: { token: latestToken() },
      cookies: inThisBrowser,
    })
    expect(consume.statusCode).toBe(200)

    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/consume',
      payload: { token: latestToken() },
      cookies: inThisBrowser,
    })
    expect(replay.statusCode).toBe(400)
  })

  /**
   * Review finding M2: a link followed by a mail scanner or a link-preview
   * bot arrives without the cookie the browser that asked for it was given,
   * and must not spend the token by itself.
   */
  it('asks a browser that did not request the link to confirm', async () => {
    await signUp('new@example.com')
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'new@example.com' },
    })
    await deliverMail()

    const scanner = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/consume',
      payload: { token: latestToken() },
    })
    expect(scanner.statusCode).toBe(403)
    expect(scanner.json().error.code).toBe('confirmation_required')

    // The link still works for the person who actually clicked it.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/magic-link/consume',
          payload: { token: latestToken() },
          cookies: linkCookieFrom(request),
        })
      ).statusCode,
    ).toBe(200)
  })

  it('accepts an explicit confirmation in place of the cookie', async () => {
    await signUp('new@example.com')
    await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'new@example.com' },
    })
    await deliverMail()

    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/consume',
      payload: { token: latestToken(), confirm: true },
    })
    expect(confirmed.statusCode).toBe(200)
  })

  /** Review finding M7: the public endpoint issues sign-in links and nothing else. */
  it('refuses a magic-link request for any purpose but sign-in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'ada@example.com', purpose: 'password-reset' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('creates no account for an unknown address asking for a link', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'stranger@example.com' },
    })
    expect(response.statusCode).toBe(202)
    await deliverMail()
    expect(mailer().sent).toHaveLength(0)
    expect(await deps.uow.repos.users.findByEmail('stranger@example.com')).toBeNull()
  })

  /**
   * The binding applies to every link, not only the sign-in one: a mail
   * scanner that follows a verification or a reset link must not spend it
   * either (ADR-011, review finding M2).
   */
  it('asks for confirmation on verification and reset links too', async () => {
    const signedUp = await signUp()
    await deliverMail()
    const scannedVerification = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: latestToken() },
    })
    expect(scannedVerification.statusCode).toBe(403)
    expect(scannedVerification.json().error.code).toBe('confirmation_required')
    // The person who clicked it still gets through.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/verify-email',
          payload: { token: latestToken() },
          cookies: linkCookieFrom(signedUp),
        })
      ).statusCode,
    ).toBe(200)

    await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { email: 'ada@example.com' },
    })
    await deliverMail()
    const scannedReset = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      payload: { token: latestToken(), newPassword: 'a fine new passphrase' },
    })
    expect(scannedReset.statusCode).toBe(403)
    expect(scannedReset.json().error.code).toBe('confirmation_required')
  })

  it('completes the email verification flow', async () => {
    // Sign-up sends the verification link itself.
    const signedUp = await signUp()
    await deliverMail()
    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: latestToken() },
      cookies: linkCookieFrom(signedUp),
    })
    expect(verify.statusCode).toBe(200)

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: 'nope' },
    })
    expect(invalid.statusCode).toBe(400)
  })

  it('completes the password reset flow, and rejects the old password afterwards', async () => {
    await signUp('ada@example.com', 'old passphrase here')
    const requested = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { email: 'ada@example.com' },
    })
    await deliverMail()

    const confirm = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      payload: { token: latestToken(), newPassword: 'new passphrase here' },
      cookies: linkCookieFrom(requested),
    })
    expect(confirm.statusCode).toBe(200)

    expect((await signIn('ada@example.com', 'old passphrase here')).statusCode).toBe(401)
    expect((await signIn('ada@example.com', 'new passphrase here')).statusCode).toBe(200)
  })

  it('refuses a breached password on reset', async () => {
    await signUp()
    const requested = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { email: 'ada@example.com' },
    })
    await deliverMail()
    breachedPasswords.breach('breachedpassword')
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      payload: { token: latestToken(), newPassword: 'breachedpassword' },
      cookies: linkCookieFrom(requested),
    })
    expect(confirm.statusCode).toBe(400)
    expect(confirm.json().error.code).toBe('breached_password')
  })

  it('rejects a password reset confirmation with an invalid token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      payload: { token: 'nope', newPassword: 'whatever it is now' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('invalid_or_expired')
  })

  /** Review finding 11. */
  it('invalidates an outstanding reset link when a newer one is issued', async () => {
    await signUp()
    const request = {
      method: 'POST' as const,
      url: '/api/auth/password-reset/request',
      payload: { email: 'ada@example.com' },
    }
    const firstRequest = await app.inject(request)
    await deliverMail()
    const first = latestToken()
    const secondRequest = await app.inject(request)
    await deliverMail()
    const second = latestToken()
    expect(second).not.toBe(first)

    const stale = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      payload: { token: first, newPassword: 'a fine new passphrase' },
      cookies: linkCookieFrom(firstRequest),
    })
    expect(stale.statusCode).toBe(400)
    expect(stale.json().error.code).toBe('invalid_or_expired')

    const fresh = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/confirm',
      payload: { token: second, newPassword: 'a fine new passphrase' },
      cookies: linkCookieFrom(secondRequest),
    })
    expect(fresh.statusCode).toBe(200)
  })
})

describe('session management', () => {
  async function signedIn(): Promise<string> {
    await signUp()
    return sessionCookieFrom(await signIn())
  }

  it('lists the caller’s sessions and marks the current one', async () => {
    const token = await signedIn()
    await signIn()

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      cookies: cookies(token),
    })
    expect(response.statusCode).toBe(200)
    const listed = response.json().sessions as { id: string; current: boolean }[]
    expect(listed).toHaveLength(2)
    expect(listed.filter((entry) => entry.current)).toHaveLength(1)
    // A listing is not a credential: no token, and no hash of one.
    expect(JSON.stringify(listed)).not.toContain(token)
    expect(JSON.stringify(listed)).not.toContain(hashSessionToken(token))
  })

  it('reports a session written before last_seen_at existed as never seen', async () => {
    const token = await signedIn()
    // ADR-033 made the column an expand-only addition, so an older row has none.
    await database.pool.query('UPDATE sessions SET last_seen_at = NULL')

    const listed = (
      await app.inject({ method: 'GET', url: '/api/auth/sessions', cookies: cookies(token) })
    ).json().sessions as { lastSeenAt: string | null }[]
    expect(listed.map((entry) => entry.lastSeenAt)).toEqual([null])
  })

  it('revokes one other session', async () => {
    const token = await signedIn()
    const other = sessionCookieFrom(await signIn())

    const listed = (
      await app.inject({ method: 'GET', url: '/api/auth/sessions', cookies: cookies(token) })
    ).json().sessions as { id: string; current: boolean }[]
    const otherId = listed.find((entry) => !entry.current)?.id ?? ''

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${otherId}`,
      cookies: cookies(token),
    })
    expect(revoke.statusCode).toBe(204)

    expect(
      (await app.inject({ method: 'GET', url: '/api/me', cookies: cookies(other) })).statusCode,
    ).toBe(401)
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', cookies: cookies(token) })).statusCode,
    ).toBe(200)
  })

  it('revokes the current session, clearing the cookie', async () => {
    const token = await signedIn()
    const listed = (
      await app.inject({ method: 'GET', url: '/api/auth/sessions', cookies: cookies(token) })
    ).json().sessions as { id: string; current: boolean }[]
    const currentId = listed.find((entry) => entry.current)?.id ?? ''

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${currentId}`,
      cookies: cookies(token),
    })
    expect(revoke.statusCode).toBe(204)
    expect(revoke.cookies.some((cookie) => cookie.value === '')).toBe(true)
  })

  it('will not revoke a session that is not the caller’s, and says only "not found"', async () => {
    const token = await signedIn()
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/auth/sessions/somebody-elses',
      cookies: cookies(token),
    })
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })

  it('signs out everywhere', async () => {
    const token = await signedIn()
    const other = sessionCookieFrom(await signIn())

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/auth/sessions',
      cookies: cookies(token),
    })
    expect(response.statusCode).toBe(204)

    for (const gone of [token, other]) {
      expect(
        (await app.inject({ method: 'GET', url: '/api/me', cookies: cookies(gone) })).statusCode,
      ).toBe(401)
    }
  })

  it('requires a session to list or revoke anything', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/sessions' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'DELETE', url: '/api/auth/sessions' })).statusCode).toBe(401)
  })
})

describe('changing a password while signed in', () => {
  it('rotates this session and ends every other one', async () => {
    await signUp()
    const other = sessionCookieFrom(await signIn())
    const current = sessionCookieFrom(await signIn())

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: cookies(current),
      payload: { currentPassword: PASSWORD, newPassword: 'a brand new passphrase' },
    })
    expect(response.statusCode).toBe(200)

    const rotated = sessionCookieFrom(response)
    expect(rotated).not.toBe(current)
    for (const gone of [other, current]) {
      expect(
        (await app.inject({ method: 'GET', url: '/api/me', cookies: cookies(gone) })).statusCode,
      ).toBe(401)
    }
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', cookies: cookies(rotated) })).statusCode,
    ).toBe(200)
  })

  it('requires the current password', async () => {
    await signUp()
    const token = sessionCookieFrom(await signIn())
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: cookies(token),
      payload: { currentPassword: 'not the password', newPassword: 'a brand new passphrase' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('refuses a breached new password', async () => {
    await signUp()
    const token = sessionCookieFrom(await signIn())
    breachedPasswords.breach('breachedpassword')
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: cookies(token),
      payload: { currentPassword: PASSWORD, newPassword: 'breachedpassword' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('breached_password')
  })

  it('requires a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { currentPassword: PASSWORD, newPassword: 'a brand new passphrase' },
    })
    expect(response.statusCode).toBe(401)
  })
})

/** Review finding 6. */
describe('rate limiting', () => {
  it('refuses a burst of sign-in attempts with 429, then lets the right password through', async () => {
    await signUp()
    for (let attempt = 0; attempt < RATE_LIMIT.max; attempt += 1) {
      expect((await signIn('ada@example.com', 'wrong but long enough')).statusCode).toBe(401)
    }

    const limited = await signIn('ada@example.com', 'wrong but long enough')
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('rate_limited')

    // Backoff, not lockout: after the window, the account works again.
    clock.advance(RATE_LIMIT.windowMs * 2)
    expect((await signIn()).statusCode).toBe(200)
  })

  it('limits one account even from a different address', async () => {
    await signUp()
    const attempt = (ip: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        payload: { email: 'ada@example.com', password: 'wrong but long enough' },
        remoteAddress: ip,
      })
    for (let index = 0; index < RATE_LIMIT.max; index += 1) {
      await attempt(`10.0.0.${index + 1}`)
    }
    expect((await attempt('10.0.0.99')).statusCode).toBe(429)
  })

  it('limits the magic-link and reset endpoints, so neither can be used to mail-bomb', async () => {
    for (const url of ['/api/auth/magic-link', '/api/auth/password-reset/request'] as const) {
      advanceOutOfEveryWindow()
      const payload =
        url === '/api/auth/magic-link'
          ? { email: 'victim@example.com', purpose: 'sign-in' }
          : { email: 'victim@example.com' }
      for (let attempt = 0; attempt < RATE_LIMIT.max; attempt += 1) {
        expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(202)
      }
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(429)
    }
  })

  it('records being rate limited in the audit log', async () => {
    await signUp()
    for (let attempt = 0; attempt < RATE_LIMIT.max + 1; attempt += 1) {
      await signIn('ada@example.com', 'wrong but long enough')
    }
    // The audit write is deliberately fire-and-forget: refusing the request
    // must not wait on it, so the assertion waits instead.
    expect(await eventually(() => countAuditEvents('auth.rate_limited'))).toBeGreaterThan(0)
  })
})

/** Review finding 8's CSRF half, end to end through the real app. */
describe('cross-site protection', () => {
  it('refuses a state-changing request from another site', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      payload: { email: 'ada@example.com', password: PASSWORD },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('cross_origin_rejected')
  })

  it('accepts the same request from the app itself', async () => {
    await signUp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { 'sec-fetch-site': 'same-origin', origin: deps.config.appOrigin },
      payload: { email: 'ada@example.com', password: PASSWORD },
    })
    expect(response.statusCode).toBe(200)
  })
})

describe('security headers', () => {
  it('are on every response, including an error', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(401)
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(response.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
  })
})

/** The number of audit rows of one type. */
async function countAuditEvents(type: string): Promise<number> {
  const { rows } = await database.pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM audit_events WHERE type = $1',
    [type],
  )
  return Number(rows[0]?.count ?? '0')
}

/** Polls a count that a fire-and-forget write is expected to raise. */
async function eventually(read: () => Promise<number>): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await read()
    if (value > 0) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  /* v8 ignore next 2 -- only reached if the audit write never lands, which is the failure. */
  return 0
}
