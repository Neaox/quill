import { createSign, generateKeyPairSync } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeClock } from '@quill/application/test-support'
import type { FakeClock } from '@quill/application/test-support'

import type {
  OutboundClient,
  OutboundPostRequest,
  OutboundResponse,
} from '../../infrastructure/http/outbound-client.ts'
import { OutboundRequestError } from '../../infrastructure/http/outbound-client.ts'
import { discoveryUrl } from './discovery.ts'
import { createOidcIdentityProvider } from './oidc-provider.ts'
import { codeChallenge } from './pkce.ts'
import type { OidcProviderConfig } from './provider-config.ts'
import type { SecretResolver } from '../../infrastructure/secrets/resolve-secret.ts'

/**
 * The parts of the flow an in-process provider cannot easily be made to do:
 * a token endpoint that answers rubbish, one that only takes the secret in
 * the body, a provider that cannot be reached at all, and the claim shapes
 * real providers differ on.
 *
 * The happy path and the protocol itself are exercised against a real
 * OpenID Connect server in `routes/auth-oidc.integration.test.ts`; this file
 * is the decision table underneath it.
 */

const ISSUER = 'https://sso.example.com'
const CLIENT_ID = 'quill-client'
const CLIENT_SECRET = 'quill secret+with/characters'
const REDIRECT_URI = 'https://docs.example.com/api/auth/oidc/acme/callback'
const NOW = new Date('2026-01-01T00:00:00.000Z')

let key: { readonly privateKey: KeyObject; readonly publicKey: KeyObject }
let jwk: Record<string, unknown>

beforeAll(() => {
  key = generateKeyPairSync('rsa', { modulusLength: 2048 })
  jwk = {
    ...(key.publicKey.export({ format: 'jwk' }) as object),
    kid: 'key-1',
    alg: 'RS256',
    use: 'sig',
  }
})

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function idToken(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'key-1' }))
  const body = base64url(JSON.stringify(payload))
  const signature = createSign('sha256')
    .update(`${header}.${body}`)
    .sign(key.privateKey)
    .toString('base64url')
  return `${header}.${body}.${signature}`
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const seconds = Math.floor(NOW.getTime() / 1000)
  return {
    iss: ISSUER,
    sub: 'subject-1',
    aud: CLIENT_ID,
    nonce: 'the-nonce',
    iat: seconds,
    exp: seconds + 300,
    email: 'ada@example.com',
    email_verified: true,
    name: 'Ada Lovelace',
    ...overrides,
  }
}

/**
 * The default resolver: what "the client secret resolved to `CLIENT_SECRET`"
 * means everywhere in this file except the "resolving the client secret"
 * describe block below, which is the one place *how* it resolves matters —
 * that is `resolve-secret.test.ts`'s job, not this file's.
 */
function fixedSecretResolver(value: string = CLIENT_SECRET): SecretResolver {
  return {
    async resolve() {
      return { ok: true, value }
    },
  }
}

function config(overrides: Partial<OidcProviderConfig> = {}): OidcProviderConfig {
  return {
    id: 'acme',
    displayName: 'Acme',
    preset: 'generic',
    issuer: ISSUER,
    clientId: CLIENT_ID,
    clientSecretName: 'oidc/acme/client-secret',
    scopes: ['openid', 'email'],
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
    ...overrides,
  }
}

interface Scenario {
  /** What the discovery document says, merged over a working one. */
  readonly discovery?: Record<string, unknown>
  /** What the token endpoint answers, or a function that throws. */
  readonly token?: OutboundResponse | (() => never)
  /** Defaults to one that always resolves to `CLIENT_SECRET`. */
  readonly secretResolver?: SecretResolver
}

let clock: FakeClock
let posted: OutboundPostRequest[]

function providerFor(scenario: Scenario = {}, overrides: Partial<OidcProviderConfig> = {}) {
  const document = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    ...scenario.discovery,
  }
  const client: OutboundClient = {
    async get({ url }) {
      if (url === discoveryUrl(ISSUER)) return { status: 200, body: JSON.stringify(document) }
      if (url === `${ISSUER}/jwks`) return { status: 200, body: JSON.stringify({ keys: [jwk] }) }
      /* v8 ignore next -- nothing else is ever fetched. */
      return { status: 404, body: '' }
    },
    async post(request) {
      posted.push(request)
      const answer = scenario.token ?? {
        status: 200,
        body: JSON.stringify({ id_token: idToken(claims()) }),
      }
      if (typeof answer === 'function') return answer()
      return answer
    },
  }
  return createOidcIdentityProvider({
    config: config(overrides),
    redirectUri: REDIRECT_URI,
    createClient: () => client,
    clock,
    secretResolver: scenario.secretResolver ?? fixedSecretResolver(),
  })
}

/** One whole round trip, with the binding `start` handed out. */
async function roundTrip(scenario: Scenario = {}, overrides: Partial<OidcProviderConfig> = {}) {
  const provider = providerFor(scenario, overrides)
  const started = await provider.start()
  if (!started.ok) throw new Error('start failed unexpectedly')
  return provider.complete({
    code: 'the-code',
    state: started.state,
    nonce: 'the-nonce',
    codeVerifier: started.codeVerifier,
  })
}

beforeEach(() => {
  clock = createFakeClock(NOW)
  posted = []
})

describe('start', () => {
  it('builds the authorisation request from the discovery document', async () => {
    const started = await providerFor().start()

    expect(started.ok).toBe(true)
    const url = new URL(started.ok ? started.authorizationUrl : '')
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(url.searchParams.get('scope')).toBe('openid email')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe(
      codeChallenge(started.ok ? started.codeVerifier : ''),
    )
  })

  it('puts the preset’s own parameters on, and lets nothing overwrite the protocol’s', async () => {
    const started = await providerFor(
      {},
      { authorizationParameters: { hd: 'example.com', response_type: 'token' } },
    ).start()

    const url = new URL(started.ok ? started.authorizationUrl : '')
    expect(url.searchParams.get('hd')).toBe('example.com')
    // An implicit-flow response type would hand a token to the browser.
    expect(url.searchParams.get('response_type')).toBe('code')
  })

  it('mints a fresh state, nonce and verifier for every attempt', async () => {
    const provider = providerFor()
    const first = await provider.start()
    const second = await provider.start()

    expect(first.ok && second.ok ? first.state === second.state : true).toBe(false)
    expect(first.ok && second.ok ? first.nonce === second.nonce : true).toBe(false)
    expect(first.ok && second.ok ? first.codeVerifier === second.codeVerifier : true).toBe(false)
  })

  it('says the provider is unavailable when its metadata cannot be read', async () => {
    const provider = createOidcIdentityProvider({
      config: config(),
      redirectUri: REDIRECT_URI,
      createClient: () => ({
        async get() {
          throw new OutboundRequestError('timeout', 'too slow')
        },
        /* v8 ignore next 3 -- the flow never gets as far as the token endpoint. */
        async post() {
          throw new Error('unreachable')
        },
      }),
      clock,
      secretResolver: fixedSecretResolver(),
    })

    expect(await provider.start()).toEqual({
      ok: false,
      reason: 'provider_unavailable',
      detail: 'discovery could not be read: too slow',
    })
  })
})

describe('the token exchange', () => {
  it('authenticates with Basic, form-encoding the parts before base64', async () => {
    await roundTrip()

    const [request] = posted
    expect(request?.contentType).toBe('application/x-www-form-urlencoded')
    const header = request?.headers?.['authorization'] ?? ''
    const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf8')
    // Form-urlencoded before base64 (RFC 6749 Appendix B): the space in this
    // secret is a `+`, not a `%20`.
    expect(decoded).toBe('quill-client:quill+secret%2Bwith%2Fcharacters')
    const form = new URLSearchParams(request?.body ?? '')
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
    })
    // The secret is in the header, not in a body some proxy may log.
    expect(form.get('client_secret')).toBeNull()
  })

  it('form-encodes the credentials the way RFC 6749 Appendix B asks', async () => {
    // A space is `+`, and `!*'()` are escaped — neither of which
    // `encodeURIComponent` does on its own.
    await roundTrip({ secretResolver: fixedSecretResolver("s!*'()~") }, { clientId: 'a b' })

    const header = posted[0]?.headers?.['authorization'] ?? ''
    const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf8')
    expect(decoded).toBe('a+b:s%21%2A%27%28%29~')
  })

  it('puts the secret in the body when the provider only takes it there', async () => {
    await roundTrip({
      discovery: { token_endpoint_auth_methods_supported: ['client_secret_post'] },
    })

    expect(posted[0]?.headers?.['authorization']).toBeUndefined()
    expect(new URLSearchParams(posted[0]?.body ?? '').get('client_secret')).toBe(CLIENT_SECRET)
  })

  it('uses Basic when the provider publishes no list, which is the specification’s default', async () => {
    await roundTrip({ discovery: { token_endpoint_auth_methods_supported: undefined } })

    expect(posted[0]?.headers?.['authorization']).toMatch(/^Basic /)
  })

  it.each([
    [
      'the endpoint cannot be reached',
      {
        token: (): never => {
          throw new OutboundRequestError('timeout', 'too slow')
        },
      },
      'the token endpoint could not be reached: too slow',
    ],
    [
      'it refuses the code',
      { token: { status: 400, body: '{"error":"invalid_grant"}' } },
      'the token endpoint answered 400 (invalid_grant)',
    ],
    [
      'it refuses with something that is not JSON',
      { token: { status: 500, body: '<html>oops</html>' } },
      'the token endpoint answered 500 (no error code)',
    ],
    [
      'it refuses with JSON that names no error',
      { token: { status: 400, body: '{"detail":"nope"}' } },
      'the token endpoint answered 400 (no error code)',
    ],
    [
      'it answers 200 with something that is not JSON',
      { token: { status: 200, body: 'not json' } },
      'the token response is not JSON',
    ],
    [
      'it answers 200 with a JSON array',
      { token: { status: 200, body: '[]' } },
      'the token response is not a JSON object',
    ],
    [
      'it answers 200 with no id_token',
      { token: { status: 200, body: '{"access_token":"a"}' } },
      'the token response carries no id_token',
    ],
  ])('fails when %s', async (_name, scenario, detail) => {
    expect(await roundTrip(scenario as Scenario)).toEqual({
      ok: false,
      reason: 'token_exchange_failed',
      detail,
    })
  })
})

describe('resolving the client secret (ADR-034)', () => {
  it('passes the secret name and the environment variable name to the resolver, and sends whatever it returns', async () => {
    const resolver: SecretResolver = {
      async resolve(fallback) {
        expect(fallback).toEqual({
          name: 'oidc/acme/client-secret',
          envVarName: 'OIDC_ACME_CLIENT_SECRET',
        })
        return { ok: true, value: 'from-the-resolver' }
      },
    }

    await roundTrip({ secretResolver: resolver })

    const header = posted[0]?.headers?.['authorization'] ?? ''
    const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString('utf8')
    expect(decoded).toBe('quill-client:from-the-resolver')
  })

  it('fails the exchange, rather than sending an empty secret, when nothing names a value', async () => {
    const resolver: SecretResolver = {
      async resolve() {
        return { ok: false, reason: 'not-found' }
      },
    }

    expect(await roundTrip({ secretResolver: resolver })).toEqual({
      ok: false,
      reason: 'token_exchange_failed',
      detail:
        'the client secret (oidc/acme/client-secret) is not usable: nothing names a value for it',
    })
    expect(posted).toEqual([])
  })

  it('fails the exchange with a different reason when the stored secret cannot be opened', async () => {
    // Different operator actions — re-enter the value, versus restore the
    // master key or run `secrets:rotate` — so the audit detail says which,
    // even though the browser sees the same failure either way (ADR-011).
    const resolver: SecretResolver = {
      async resolve() {
        return { ok: false, reason: 'unreadable' }
      },
    }

    expect(await roundTrip({ secretResolver: resolver })).toEqual({
      ok: false,
      reason: 'token_exchange_failed',
      detail:
        'the client secret (oidc/acme/client-secret) is not usable: no master key held by this instance can open it',
    })
  })
})

describe('the identity a completed sign-in yields', () => {
  it('carries the subject, the email, the name and the raw claims', async () => {
    const result = await roundTrip()

    expect(result).toMatchObject({
      ok: true,
      identity: {
        issuer: ISSUER,
        subject: 'subject-1',
        email: 'ada@example.com',
        emailVerified: true,
        displayName: 'Ada Lovelace',
        groups: [],
      },
    })
  })

  it.each([
    ['an array, as most providers spell it', ['engineering', 'oncall']],
    ['a space-separated string, as some do', 'engineering oncall'],
  ])('reads groups from %s', async (_name, groups) => {
    const result = await roundTrip({
      token: { status: 200, body: JSON.stringify({ id_token: idToken(claims({ groups })) }) },
    })

    expect(result.ok ? result.identity.groups : []).toEqual(['engineering', 'oncall'])
  })

  it('ignores group entries that are not strings', async () => {
    const result = await roundTrip({
      token: {
        status: 200,
        body: JSON.stringify({ id_token: idToken(claims({ groups: ['engineering', 7] })) }),
      },
    })

    expect(result.ok ? result.identity.groups : []).toEqual(['engineering'])
  })

  it('has no groups when the preset names no group claim', async () => {
    const result = await roundTrip(
      {
        token: {
          status: 200,
          body: JSON.stringify({ id_token: idToken(claims({ groups: ['a'] })) }),
        },
      },
      {
        claims: {
          email: 'email',
          emailVerified: 'email_verified',
          displayName: 'name',
          groups: null,
        },
      },
    )

    expect(result.ok ? result.identity.groups : ['a']).toEqual([])
  })

  it('accepts `email_verified` as the string some providers send', async () => {
    const result = await roundTrip({
      token: {
        status: 200,
        body: JSON.stringify({ id_token: idToken(claims({ email_verified: 'true' })) }),
      },
    })

    expect(result.ok ? result.identity.emailVerified : false).toBe(true)
  })

  it.each([
    ['a claim that is not a boolean or "true"', { email_verified: 'yes' }],
    ['no such claim at all', { email_verified: undefined }],
  ])('treats %s as not verified', async (_name, overrides) => {
    const payload = claims(overrides)
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete payload[name]
    }
    const result = await roundTrip({
      token: { status: 200, body: JSON.stringify({ id_token: idToken(payload) }) },
    })

    expect(result.ok ? result.identity.emailVerified : true).toBe(false)
  })

  it('has no email and no name when the provider asserts neither', async () => {
    const payload = claims()
    delete payload['email']
    delete payload['name']
    const result = await roundTrip({
      token: { status: 200, body: JSON.stringify({ id_token: idToken(payload) }) },
    })

    expect(result).toMatchObject({ ok: true, identity: { email: null, displayName: null } })
  })
})

describe('the preset’s own claim checks', () => {
  it('accepts a token that carries the configured value', async () => {
    const result = await roundTrip(
      {
        token: {
          status: 200,
          body: JSON.stringify({ id_token: idToken(claims({ tid: 'tenant-1' })) }),
        },
      },
      { claimChecks: [{ claim: 'tid', expected: 'tenant-1' }] },
    )

    expect(result.ok).toBe(true)
  })

  it('refuses a token from another tenant, however well it verifies', async () => {
    const result = await roundTrip(
      {
        token: {
          status: 200,
          body: JSON.stringify({ id_token: idToken(claims({ tid: 'somebody-else' })) }),
        },
      },
      { claimChecks: [{ claim: 'tid', expected: 'tenant-1' }] },
    )

    expect(result).toEqual({
      ok: false,
      reason: 'claim_rejected',
      detail: 'the tid claim is not the configured value',
    })
  })
})

describe('a token that does not verify', () => {
  it('is refused as an invalid token, with the reason kept for the audit log', async () => {
    const result = await roundTrip({
      token: {
        status: 200,
        body: JSON.stringify({ id_token: idToken(claims({ nonce: 'another-attempt' })) }),
      },
    })

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_token',
      detail: 'nonce does not match this sign-in attempt',
    })
  })

  it('reports the provider unavailable when a key refresh cannot be read', async () => {
    let reads = 0
    const provider = createOidcIdentityProvider({
      config: config(),
      redirectUri: REDIRECT_URI,
      createClient: () => ({
        async get({ url }) {
          if (url === discoveryUrl(ISSUER)) {
            return {
              status: 200,
              body: JSON.stringify({
                issuer: ISSUER,
                authorization_endpoint: `${ISSUER}/authorize`,
                token_endpoint: `${ISSUER}/token`,
                jwks_uri: `${ISSUER}/jwks`,
              }),
            }
          }
          reads += 1
          // The first read publishes a key nothing is signed with, so the
          // token names an unknown `kid`; the refresh then fails outright.
          if (reads === 1) {
            return {
              status: 200,
              body: JSON.stringify({
                keys: [{ ...jwk, kid: 'another-key' }],
              }),
            }
          }
          return { status: 503, body: '' }
        },
        async post() {
          return { status: 200, body: JSON.stringify({ id_token: idToken(claims()) }) }
        },
      }),
      clock,
      secretResolver: fixedSecretResolver(),
      minKeyRefreshIntervalMs: 0,
    })

    const started = await provider.start()
    clock.advance(1)
    const result = await provider.complete({
      code: 'the-code',
      state: started.ok ? started.state : '',
      nonce: 'the-nonce',
      codeVerifier: started.ok ? started.codeVerifier : '',
    })

    expect(result).toEqual({
      ok: false,
      reason: 'provider_unavailable',
      detail: 'the key set answered 503',
    })
  })

  it('says the provider is unavailable when `complete` cannot read its metadata', async () => {
    let reachable = true
    const provider = createOidcIdentityProvider({
      config: config(),
      redirectUri: REDIRECT_URI,
      createClient: () => ({
        async get({ url }) {
          if (!reachable) throw new OutboundRequestError('timeout', 'too slow')
          if (url === discoveryUrl(ISSUER)) {
            return {
              status: 200,
              body: JSON.stringify({
                issuer: ISSUER,
                authorization_endpoint: `${ISSUER}/authorize`,
                token_endpoint: `${ISSUER}/token`,
                jwks_uri: `${ISSUER}/jwks`,
              }),
            }
          }
          return { status: 200, body: JSON.stringify({ keys: [jwk] }) }
        },
        /* v8 ignore next 3 -- the exchange is never reached. */
        async post() {
          throw new Error('unreachable')
        },
      }),
      clock,
      secretResolver: fixedSecretResolver(),
      metadataTtlMs: 1,
    })

    const started = await provider.start()
    // The cached metadata ages out, and by then the provider is gone.
    clock.advance(10)
    reachable = false
    const result = await provider.complete({
      code: 'the-code',
      state: started.ok ? started.state : '',
      nonce: 'the-nonce',
      codeVerifier: started.ok ? started.codeVerifier : '',
    })

    expect(result).toMatchObject({ ok: false, reason: 'provider_unavailable' })
  })
})
