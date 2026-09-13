import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeClock } from '@quill/application/test-support'
import type { FakeClock } from '@quill/application/test-support'
import { userId } from '@quill/domain'
import type { UserId } from '@quill/domain'

import type { OidcProviderConfig } from '../auth/oidc/provider-config.ts'
import { HARNESS_NOW, createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { startFakeOidcProvider } from '../test-support/fake-oidc-provider.ts'
import type { FakeOidcProvider } from '../test-support/fake-oidc-provider.ts'

/**
 * Single sign-on, end to end, against a real OpenID Connect provider running
 * in this process (plan §23, ADR-011; use case 38).
 *
 * The whole flow runs: the sign-in page's provider list, the redirect to the
 * provider with PKCE, the provider's own checks on the callback, the token
 * exchange with client authentication, the signature check against the
 * published key set, the claim checks, linking or provisioning, and the
 * session cookie the browser leaves with.
 *
 * Every refusal in here is asserted to look identical from the browser's side
 * — `302` to `/sign-in?error=sso` and no session — and to be distinguishable
 * only in the audit log, which is the enumeration rule from ADR-011.
 */

const CLIENT_ID = 'quill-client'
const CLIENT_SECRET = 'quill-secret'

let clock: FakeClock
let provider: FakeOidcProvider
let harness: ServerHarness

/** Drives one browser round trip and answers with the callback's reply. */
async function signInThrough(
  options: {
    readonly redirect?: string
    readonly cookies?: Record<string, string>
    readonly providerId?: string
  } = {},
) {
  const id = options.providerId ?? 'acme'
  const start = await harness.app.inject({
    method: 'GET',
    url: `/api/auth/oidc/${id}/start${options.redirect === undefined ? '' : `?redirect=${encodeURIComponent(options.redirect)}`}`,
    ...(options.cookies === undefined ? {} : { cookies: options.cookies }),
  })
  const authorizationUrl = start.headers['location'] as string
  const { code, state } = provider.authorize(authorizationUrl)
  const callback = await harness.app.inject({
    method: 'GET',
    url: `/api/auth/oidc/${id}/callback?code=${code}&state=${encodeURIComponent(state)}`,
    cookies: { ...options.cookies, ...cookiesFrom(start) },
  })
  return { start, authorizationUrl, callback }
}

/**
 * An account that already exists here under the address the provider will
 * assert. `verified` is the whole question a link turns on: an account that
 * has proved the address may be linked into, and one that has not may not.
 */
async function localAccount(options: { readonly verified?: boolean } = {}): Promise<UserId> {
  const id = userId('11111111-1111-4111-8111-111111111111')
  await harness.deps.uow.repos.users.create({
    id,
    email: 'ada@example.com',
    displayName: 'Ada',
    now: clock.now(),
  })
  if (options.verified ?? true) {
    await harness.deps.uow.repos.users.markEmailVerified(id, clock.now())
  }
  return id
}

/** The `reason` on every `auth.sso.failed` row, in order. */
async function auditReasons(): Promise<unknown[]> {
  const rows = await harness.database.pool.query<{ metadata: { reason?: unknown } }>(
    "SELECT metadata FROM audit_events WHERE type = 'auth.sso.failed' ORDER BY created_at, id",
  )
  return rows.rows.map((row) => row.metadata.reason)
}

/** The cookies a reply set, as `app.inject` wants them back. */
function cookiesFrom(reply: { cookies: unknown[] }): Record<string, string> {
  const jar: Record<string, string> = {}
  for (const cookie of reply.cookies as { name: string; value: string }[]) {
    if (cookie.value.length > 0) jar[cookie.name] = cookie.value
  }
  return jar
}

function sessionCookie(reply: { cookies: unknown[] }): string | undefined {
  return cookiesFrom(reply)[harness.deps.config.session.cookieName]
}

async function auditTypes(): Promise<string[]> {
  const rows = await harness.database.pool.query<{ type: string }>(
    'SELECT type FROM audit_events ORDER BY created_at, id',
  )
  return rows.rows.map((row) => row.type)
}

beforeAll(async () => {
  clock = createFakeClock(HARNESS_NOW)
  provider = await startFakeOidcProvider({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    now: () => clock.now(),
  })
  const config: OidcProviderConfig = {
    id: 'acme',
    displayName: 'Acme SSO',
    preset: 'generic',
    issuer: provider.issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    scopes: ['openid', 'email', 'profile'],
    claims: {
      email: 'email',
      emailVerified: 'email_verified',
      displayName: 'name',
      groups: 'groups',
    },
    authorizationParameters: {},
    claimChecks: [],
    allowSignUp: true,
    allowLinking: true,
  }
  // A second provider pointing at a path the fake serves nothing on, so
  // "the provider cannot be reached" is a real case rather than a mocked one.
  const unreachable: OidcProviderConfig = {
    ...config,
    id: 'unreachable',
    displayName: 'Nowhere',
    issuer: `${provider.issuer}/nowhere`,
  }
  // The same directory, configured not to attach itself to accounts that
  // already exist (ADR-011's linking policy).
  const noLinking: OidcProviderConfig = {
    ...config,
    id: 'nolink',
    displayName: 'Acme SSO (no linking)',
    allowLinking: false,
  }
  harness = await createServerHarness({
    clock,
    oidcProviders: [config, unreachable, noLinking],
    createOidcClient: provider.createClient,
  })
}, 60_000)

afterAll(async () => {
  await harness.close()
  await provider.close()
})

beforeEach(async () => {
  provider.nextToken({})
  await harness.database.pool.query('DELETE FROM identities')
  await harness.database.pool.query('DELETE FROM sessions')
  await harness.database.pool.query('DELETE FROM users')
  await harness.database.pool.query('DELETE FROM audit_events')
})

describe('GET /api/auth/oidc/providers', () => {
  it('lists what the sign-in page may offer, and nothing else', async () => {
    const reply = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/providers' })

    expect(reply.statusCode).toBe(200)
    expect(reply.json()).toEqual({
      providers: [
        { id: 'acme', displayName: 'Acme SSO' },
        { id: 'unreachable', displayName: 'Nowhere' },
        { id: 'nolink', displayName: 'Acme SSO (no linking)' },
      ],
    })
  })
})

describe('GET /api/auth/oidc/:id/start', () => {
  it('redirects to the provider with code, PKCE, state and nonce', async () => {
    const reply = await harness.app.inject({
      method: 'GET',
      url: '/api/auth/oidc/acme/start?redirect=%2Fw%2Fengineering',
    })

    expect(reply.statusCode).toBe(302)
    const url = new URL(reply.headers['location'] as string)
    expect(url.origin + url.pathname).toBe(`${provider.issuer}/authorize`)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${harness.deps.config.appUrl}/api/auth/oidc/acme/callback`,
    )
    // The secrets go to the browser in one HttpOnly cookie and nowhere else.
    expect(reply.headers['cache-control']).toBe('no-store')
    expect(cookiesFrom(reply)[harness.deps.config.session.oidcCookieName]).toBeDefined()
    expect(await auditTypes()).toEqual(['auth.sso.started'])
  })

  it('is not found for a provider nobody configured', async () => {
    const reply = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/okta/start' })
    expect(reply.statusCode).toBe(404)
  })

  it('sends the browser to the failure page when the provider cannot be reached', async () => {
    const reply = await harness.app.inject({
      method: 'GET',
      url: '/api/auth/oidc/unreachable/start',
    })

    expect(reply.statusCode).toBe(302)
    expect(reply.headers['location']).toBe('/sign-in?error=sso')
    // No attempt was opened, so there is no cookie to spend later.
    expect(cookiesFrom(reply)[harness.deps.config.session.oidcCookieName]).toBeUndefined()
    expect(await auditTypes()).toEqual(['auth.sso.failed'])
  })
})

describe('the whole round trip', () => {
  it('provisions an account, issues a session, and returns to the asked-for page', async () => {
    const { callback } = await signInThrough({ redirect: '/w/engineering' })

    expect(callback.statusCode).toBe(302)
    expect(callback.headers['location']).toBe('/w/engineering')
    expect(sessionCookie(callback)).toBeDefined()

    const me = await harness.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: cookiesFrom(callback),
    })
    expect(me.json()).toMatchObject({
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      // A provider that vouches for the address is the verification.
      emailVerified: true,
    })
    expect(await auditTypes()).toEqual([
      'auth.sso.started',
      'auth.sso.provisioned',
      'auth.sso.succeeded',
    ])
  })

  it('matches a returning person by subject, not by the email they now use', async () => {
    await signInThrough()
    provider.nextToken({ email: 'ada.lovelace@example.com' })

    const { callback } = await signInThrough()

    expect(callback.statusCode).toBe(302)
    const users = await harness.database.pool.query<{ email: string }>('SELECT email FROM users')
    // One account, still under the address it was created with.
    expect(users.rows).toEqual([{ email: 'ada@example.com' }])
    const identities = await harness.database.pool.query('SELECT * FROM identities')
    expect(identities.rowCount).toBe(1)
  })

  it('links to an account that has verified this address for itself', async () => {
    const existing = await localAccount()

    const { callback } = await signInThrough()

    expect(callback.statusCode).toBe(302)
    const rows = await harness.database.pool.query<{ user_id: string; subject: string }>(
      'SELECT user_id, subject FROM identities',
    )
    expect(rows.rows).toEqual([{ user_id: existing, subject: 'provider-subject-1' }])
    expect(await auditTypes()).toContain('auth.sso.linked')
  })

  /**
   * The pre-registration attack, end to end: a squatter signs up with
   * somebody else's work address and never opens the mail. The first
   * federated sign-in must not hand them the account.
   */
  it('refuses to link into an account that has never proved the address', async () => {
    const squatted = await localAccount({ verified: false })

    const { callback } = await signInThrough()

    expect(callback.headers['location']).toBe('/sign-in?error=sso')
    expect(sessionCookie(callback)).toBeUndefined()
    const rows = await harness.database.pool.query('SELECT * FROM identities')
    expect(rows.rowCount).toBe(0)
    expect(await auditReasons()).toEqual(['unverified_local_account'])
    // And no second account for the same mailbox either.
    const users = await harness.database.pool.query<{ id: string }>('SELECT id FROM users')
    expect(users.rows).toEqual([{ id: squatted }])
  })

  it('refuses to link at all when the provider is configured not to', async () => {
    await localAccount()

    const { callback } = await signInThrough({ providerId: 'nolink' })

    expect(callback.headers['location']).toBe('/sign-in?error=sso')
    expect(sessionCookie(callback)).toBeUndefined()
    expect(await auditReasons()).toEqual(['linking_not_allowed'])
  })

  it('revokes every other session the account held when a link is made', async () => {
    const existing = await localAccount()
    const elsewhere = await harness.cookiesFor(existing)

    const { callback } = await signInThrough()

    expect(callback.statusCode).toBe(302)
    // The session somebody else was holding on this account is gone; only the
    // one this sign-in issued remains.
    const stillMine = await harness.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: elsewhere,
    })
    expect(stillMine.statusCode).toBe(401)
    const rows = await harness.database.pool.query('SELECT * FROM sessions')
    expect(rows.rowCount).toBe(1)
  })

  it('refuses an unverified email rather than linking on it', async () => {
    await harness.deps.uow.repos.users.create({
      id: userId('22222222-2222-4222-8222-222222222222'),
      email: 'ada@example.com',
      displayName: 'Ada',
      now: clock.now(),
    })
    provider.nextToken({ emailVerified: false })

    const { callback } = await signInThrough()

    expect(callback.statusCode).toBe(302)
    expect(callback.headers['location']).toBe('/sign-in?error=sso')
    expect(sessionCookie(callback)).toBeUndefined()
    expect(
      await harness.deps.uow.repos.identities.listForUser(
        userId('22222222-2222-4222-8222-222222222222'),
      ),
    ).toEqual([])
    expect(await auditTypes()).toContain('auth.sso.failed')
  })

  it('refuses a provider that asserts no email at all', async () => {
    provider.nextToken({ email: null })

    const { callback } = await signInThrough()

    expect(callback.headers['location']).toBe('/sign-in?error=sso')
  })

  it('rotates the session this browser already held', async () => {
    const first = await signInThrough()
    const firstCookies = cookiesFrom(first.callback)
    provider.nextToken({})

    const second = await signInThrough({ cookies: firstCookies })

    expect(sessionCookie(second.callback)).not.toBe(sessionCookie(first.callback))
    const rows = await harness.database.pool.query('SELECT * FROM sessions')
    expect(rows.rowCount).toBe(1)
  })

  it('signs in over a session cookie that no longer names a row', async () => {
    const { callback } = await signInThrough({
      cookies: { [harness.deps.config.session.cookieName]: 'a-token-nothing-knows-about' },
    })

    expect(callback.statusCode).toBe(302)
    expect(sessionCookie(callback)).toBeDefined()
  })

  it('reads the discovery document once and keeps it', async () => {
    const before = provider.requests.filter(
      (path) => path === '/.well-known/openid-configuration',
    ).length
    await signInThrough()
    await signInThrough()

    expect(
      provider.requests.filter((path) => path === '/.well-known/openid-configuration').length,
    ).toBe(before)
  })
})

describe('a callback that must not be believed', () => {
  it('refuses a state that does not match the cookie', async () => {
    const start = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    const { code } = provider.authorize(start.headers['location'] as string)

    const callback = await harness.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/acme/callback?code=${code}&state=not-the-state`,
      cookies: cookiesFrom(start),
    })

    expect(callback.headers['location']).toBe('/sign-in?error=sso')
    expect(sessionCookie(callback)).toBeUndefined()
  })

  it('refuses a callback with no cookie at all, which is what login CSRF looks like', async () => {
    const start = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    const { code, state } = provider.authorize(start.headers['location'] as string)

    const callback = await harness.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/acme/callback?code=${code}&state=${encodeURIComponent(state)}`,
    })

    expect(callback.headers['location']).toBe('/sign-in?error=sso')
  })

  it('refuses a cookie that belongs to another provider', async () => {
    const start = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    const { code, state } = provider.authorize(start.headers['location'] as string)
    const jar = cookiesFrom(start)
    const name = harness.deps.config.session.oidcCookieName
    const held = JSON.parse(Buffer.from(jar[name] ?? '', 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >

    const callback = await harness.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/acme/callback?code=${code}&state=${encodeURIComponent(state)}`,
      cookies: {
        [name]: Buffer.from(
          JSON.stringify({ ...held, providerId: 'somebody-else' }),
          'utf8',
        ).toString('base64url'),
      },
    })

    expect(callback.headers['location']).toBe('/sign-in?error=sso')
  })

  it('does not follow a return path a browser edited into its own cookie', async () => {
    const start = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    const { code, state } = provider.authorize(start.headers['location'] as string)
    const name = harness.deps.config.session.oidcCookieName
    const held = JSON.parse(
      Buffer.from(cookiesFrom(start)[name] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>

    const callback = await harness.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/acme/callback?code=${code}&state=${encodeURIComponent(state)}`,
      cookies: {
        [name]: Buffer.from(
          JSON.stringify({ ...held, returnTo: 'https://evil.example/' }),
          'utf8',
        ).toString('base64url'),
      },
    })

    // Signed in, and sent to this application rather than to the address the
    // cookie was edited to carry.
    expect(sessionCookie(callback)).toBeDefined()
    expect(callback.headers['location']).toBe('/')
  })

  it('refuses a callback carrying no code', async () => {
    const start = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    const { state } = provider.authorize(start.headers['location'] as string)

    const callback = await harness.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/acme/callback?state=${encodeURIComponent(state)}`,
      cookies: cookiesFrom(start),
    })

    expect(callback.headers['location']).toBe('/sign-in?error=sso')
  })

  it('refuses when the provider itself says no', async () => {
    const start = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })

    const callback = await harness.app.inject({
      method: 'GET',
      url: '/api/auth/oidc/acme/callback?error=access_denied',
      cookies: cookiesFrom(start),
    })

    expect(callback.headers['location']).toBe('/sign-in?error=sso')
    expect(await auditTypes()).toEqual(['auth.sso.started', 'auth.sso.failed'])
  })

  it('refuses a code the provider will not exchange', async () => {
    const start = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    const { state } = provider.authorize(start.headers['location'] as string)

    const callback = await harness.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/acme/callback?code=never-issued&state=${encodeURIComponent(state)}`,
      cookies: cookiesFrom(start),
    })

    expect(callback.headers['location']).toBe('/sign-in?error=sso')
  })

  it('refuses a code that has already been spent', async () => {
    const start = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    const { code, state } = provider.authorize(start.headers['location'] as string)
    const jar = cookiesFrom(start)
    const url = `/api/auth/oidc/acme/callback?code=${code}&state=${encodeURIComponent(state)}`
    await harness.app.inject({ method: 'GET', url, cookies: jar })

    const replay = await harness.app.inject({ method: 'GET', url, cookies: jar })

    expect(replay.headers['location']).toBe('/sign-in?error=sso')
    expect(sessionCookie(replay)).toBeUndefined()
  })

  it('refuses a token minted for another client', async () => {
    provider.nextToken({ audience: 'somebody-elses-client' })
    const { callback } = await signInThrough()
    expect(callback.headers['location']).toBe('/sign-in?error=sso')
  })

  it('refuses a token from another issuer', async () => {
    provider.nextToken({ issuer: 'https://not-the-issuer.example' })
    const { callback } = await signInThrough()
    expect(callback.headers['location']).toBe('/sign-in?error=sso')
  })

  it('refuses a token that has expired', async () => {
    provider.nextToken({ expiresInSeconds: -600 })
    const { callback } = await signInThrough()
    expect(callback.headers['location']).toBe('/sign-in?error=sso')
  })

  it('refuses a token whose nonce belongs to another attempt', async () => {
    const first = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    const second = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    // The code comes from the first attempt — so the token repeats the first
    // attempt's nonce — while the cookie is the second attempt's.
    const { code } = provider.authorize(first.headers['location'] as string)
    const secondJar = cookiesFrom(second)
    const held = JSON.parse(
      Buffer.from(
        secondJar[harness.deps.config.session.oidcCookieName] ?? '',
        'base64url',
      ).toString('utf8'),
    ) as { state: string }

    const callback = await harness.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/acme/callback?code=${code}&state=${encodeURIComponent(held.state)}`,
      cookies: secondJar,
    })

    expect(callback.headers['location']).toBe('/sign-in?error=sso')
  })
})

describe('the budget the two endpoints share', () => {
  it('is large, flat, and per address — not the auth endpoints’ backing-off one', () => {
    const { oidcRateLimit, rateLimit } = harness.deps.config

    expect(oidcRateLimit.max).toBe(300)
    // Flat: the window is its own maximum, so the doubling in
    // `auth/rate-limit.ts` can never lengthen it. A whole office behind one
    // NAT is one key, and must not be locked out of sign-in for an hour.
    expect(oidcRateLimit.windowMs).toBe(60_000)
    expect(oidcRateLimit.maxWindowMs).toBe(oidcRateLimit.windowMs)
    // And it counts on its own limiter, so a spent auth budget is not also a
    // spent sign-in budget — and a sign-in flood does not double the window a
    // password attempt then has to wait for.
    expect(harness.deps.oidcRateLimiter).not.toBe(harness.deps.rateLimiter)
    expect(rateLimit.maxWindowMs).toBeGreaterThan(rateLimit.windowMs)
  })

  it('refuses past the budget, and a completed sign-in clears it', async () => {
    const limiter = harness.deps.oidcRateLimiter
    const max = harness.deps.config.oidcRateLimit.max
    for (let spent = 0; spent < max; spent += 1) limiter.hit('oidc:address:127.0.0.1')

    const refused = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    expect(refused.statusCode).toBe(429)

    // A round trip that finishes hands the budget back, so the next person
    // through the same NAT is not queued behind the failed attempts.
    limiter.reset('oidc:address:127.0.0.1')
    for (let spent = 0; spent < max - 2; spent += 1) limiter.hit('oidc:address:127.0.0.1')
    const { callback } = await signInThrough()
    expect(callback.statusCode).toBe(302)

    const after = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    expect(after.statusCode).toBe(302)
  })
})

describe('key rotation', () => {
  it('re-reads the key set when a token names a key the cached set does not hold', async () => {
    // The first sign-in caches the current key set.
    await signInThrough()
    provider.rotateKeys()
    provider.nextToken({})
    // The key cache will not go back to the provider more often than its own
    // floor allows, so that a stream of invented key ids cannot be turned
    // into outbound traffic. A real rotation is minutes apart, not seconds.
    clock.advance(5 * 60_000)

    const { callback } = await signInThrough()

    expect(callback.statusCode).toBe(302)
    expect(callback.headers['location']).toBe('/')
    expect(sessionCookie(callback)).toBeDefined()
  })
})

const form = (fields: Readonly<Record<string, string>>) => new URLSearchParams(fields).toString()

function basic(id: string, secret: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${id}:${secret}`, 'utf8').toString('base64')}` }
}

/**
 * The fake is only worth testing through if it really enforces what a
 * provider enforces. These drive its token endpoint directly, with forms the
 * platform itself would never send.
 */
describe('the fake provider itself', () => {
  /** A live authorisation, and everything the platform sent with it. */
  async function pending() {
    const start = await harness.app.inject({ method: 'GET', url: '/api/auth/oidc/acme/start' })
    const query = new URL(start.headers['location'] as string).searchParams
    const { code } = provider.authorize(start.headers['location'] as string)
    return { code, redirectUri: query.get('redirect_uri') ?? '' }
  }

  function token(body: string, headers: Record<string, string> = {}) {
    return provider.createClient([provider.host]).post({
      url: `${provider.issuer}/token`,
      body,
      contentType: 'application/x-www-form-urlencoded',
      headers,
    })
  }

  it('answers 404 for a path the flow never asks for', async () => {
    const reply = await provider.createClient([provider.host]).get({
      url: `${provider.issuer}/nothing-here`,
    })
    expect(reply.status).toBe(404)
  })

  it('refuses a client that presents the wrong secret', async () => {
    const { code, redirectUri } = await pending()

    const reply = await token(
      form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
      basic(CLIENT_ID, 'not-the-secret'),
    )

    expect(reply.status).toBe(401)
    expect(JSON.parse(reply.body)).toEqual({ error: 'invalid_client' })
  })

  it('accepts a client that puts its secret in the body instead', async () => {
    const { code, redirectUri } = await pending()

    const reply = await token(
      form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: 'not-the-verifier',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    )

    // Authenticated, and then refused on the verifier — which is the point.
    expect(reply.status).toBe(400)
    expect(JSON.parse(reply.body)).toEqual({ error: 'invalid_grant' })
  })

  it('refuses a redirect URI that is not the one the code was issued for', async () => {
    const { code } = await pending()

    const reply = await token(
      form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://elsewhere.example/callback',
        code_verifier: 'anything',
      }),
      basic(CLIENT_ID, CLIENT_SECRET),
    )

    expect(reply.status).toBe(400)
  })

  it('refuses a code nobody issued', async () => {
    const reply = await token(
      form({
        grant_type: 'authorization_code',
        code: 'never-issued',
        redirect_uri: 'https://elsewhere.example/callback',
        code_verifier: 'anything',
      }),
      basic(CLIENT_ID, CLIENT_SECRET),
    )

    expect(reply.status).toBe(400)
  })
})
