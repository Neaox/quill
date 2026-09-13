import { describe, expect, it } from 'vitest'
import { createFakeClock } from '@quill/application/test-support'

import type { OutboundClient, OutboundResponse } from '../../infrastructure/http/outbound-client.ts'
import { OutboundRequestError } from '../../infrastructure/http/outbound-client.ts'
import { createMetadataCache, describe as describeError, discoveryUrl } from './discovery.ts'

const ISSUER = 'https://sso.example.com'
const NOW = new Date('2026-01-01T00:00:00.000Z')

function document(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: 'https://tokens.example.com/oauth2/token',
    jwks_uri: `${ISSUER}/jwks`,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 7],
    ...overrides,
  })
}

const KEYS = JSON.stringify({ keys: [{ kty: 'RSA', kid: 'k1', n: 'n', e: 'AQAB' }] })

/** A client that answers from a table of URL to response, and counts what it was asked. */
function clientFrom(
  answers: Readonly<Record<string, OutboundResponse | (() => never)>>,
  seen: { url: string; hosts: readonly string[] }[] = [],
) {
  return {
    calls: seen,
    factory: (hosts: readonly string[]): OutboundClient => ({
      async get({ url }) {
        seen.push({ url, hosts })
        const answer = answers[url]
        if (answer === undefined) return { status: 404, body: '' }
        if (typeof answer === 'function') return answer()
        return answer
      },
      /* v8 ignore next 3 -- discovery never posts; the shape is here because
         `OutboundClient` is one interface. */
      async post() {
        throw new Error('discovery never posts')
      },
    }),
  }
}

function cacheOver(
  answers: Readonly<Record<string, OutboundResponse | (() => never)>>,
  options: { readonly ttlMs?: number; readonly minRefreshIntervalMs?: number } = {},
) {
  const clock = createFakeClock(NOW)
  const client = clientFrom(answers)
  return {
    clock,
    client,
    cache: createMetadataCache({
      issuer: ISSUER,
      createClient: client.factory,
      clock,
      ttlMs: options.ttlMs ?? 60_000,
      minRefreshIntervalMs: options.minRefreshIntervalMs ?? 30_000,
    }),
  }
}

const GOOD = {
  [discoveryUrl(ISSUER)]: { status: 200, body: document() },
  [`${ISSUER}/jwks`]: { status: 200, body: KEYS },
}

describe('discoveryUrl', () => {
  it('is the issuer plus the well-known path', () => {
    expect(discoveryUrl(ISSUER)).toBe('https://sso.example.com/.well-known/openid-configuration')
  })

  it('does not double the slash Auth0 publishes on its issuer', () => {
    expect(discoveryUrl('https://acme.auth0.com/')).toBe(
      'https://acme.auth0.com/.well-known/openid-configuration',
    )
  })
})

describe('the metadata cache', () => {
  it('reads the document and the key set, and names every host they live on', async () => {
    const { cache, client } = cacheOver(GOOD)

    const result = await cache.get()

    expect(result).toMatchObject({
      ok: true,
      metadata: {
        discovery: {
          issuer: ISSUER,
          tokenEndpoint: 'https://tokens.example.com/oauth2/token',
          // The non-string entry is dropped rather than believed.
          tokenEndpointAuthMethods: ['client_secret_basic'],
          hosts: ['sso.example.com', 'tokens.example.com'],
        },
      },
    })
    // The discovery fetch is allowed the issuer's host only; the key set is
    // fetched on the allowlist the document itself justified.
    expect(client.calls[0]?.hosts).toEqual(['sso.example.com'])
    expect(client.calls[1]?.hosts).toEqual(['sso.example.com', 'tokens.example.com'])
  })

  it('has no authentication methods when the provider publishes none', async () => {
    const { cache } = cacheOver({
      [discoveryUrl(ISSUER)]: {
        status: 200,
        body: document({ token_endpoint_auth_methods_supported: undefined }),
      },
      [`${ISSUER}/jwks`]: { status: 200, body: KEYS },
    })

    const result = await cache.get()

    expect(result.ok ? result.metadata.discovery.tokenEndpointAuthMethods : ['x']).toEqual([])
  })

  it('keeps what it read until the TTL is up', async () => {
    const { cache, client, clock } = cacheOver(GOOD, { ttlMs: 60_000 })

    await cache.get()
    await cache.get()
    expect(client.calls).toHaveLength(2)

    clock.advance(60_001)
    await cache.get()
    expect(client.calls).toHaveLength(4)
  })

  it('reads once when several sign-ins meet a cold cache at the same moment', async () => {
    const { cache, client } = cacheOver(GOOD)

    await Promise.all([cache.get(), cache.get(), cache.get()])

    expect(client.calls).toHaveLength(2)
  })

  it('re-reads the key set when a token names a key it does not hold', async () => {
    const { cache, client, clock } = cacheOver(GOOD, { minRefreshIntervalMs: 30_000 })
    await cache.get()

    clock.advance(30_000)
    const refreshed = await cache.refreshKeys()

    expect(refreshed.ok).toBe(true)
    expect(client.calls.filter((call) => call.url.endsWith('/jwks'))).toHaveLength(2)
  })

  it('will not re-read the key set more often than its own floor allows', async () => {
    const { cache, client } = cacheOver(GOOD, { minRefreshIntervalMs: 30_000 })
    await cache.get()

    const refreshed = await cache.refreshKeys()

    expect(refreshed.ok).toBe(true)
    expect(client.calls.filter((call) => call.url.endsWith('/jwks'))).toHaveLength(1)
  })

  it('counts a failed refresh against the floor, so a broken key set is asked once', async () => {
    const answers: Record<string, OutboundResponse> = {
      [discoveryUrl(ISSUER)]: { status: 200, body: document() },
      [`${ISSUER}/jwks`]: { status: 200, body: KEYS },
    }
    const { cache, client, clock } = cacheOver(answers, { minRefreshIntervalMs: 30_000 })
    await cache.get()
    answers[`${ISSUER}/jwks`] = { status: 503, body: '' }
    clock.advance(30_000)

    expect((await cache.refreshKeys()).ok).toBe(false)
    const afterFailure = client.calls.filter((call) => call.url.endsWith('/jwks')).length
    // A second token naming an unknown key, a moment later, must not become a
    // second request: the floor counts attempts, not successes.
    expect((await cache.refreshKeys()).ok).toBe(true)
    expect(client.calls.filter((call) => call.url.endsWith('/jwks'))).toHaveLength(afterFailure)
  })

  it('fetches everything when asked to refresh keys before anything is cached', async () => {
    const { cache, client } = cacheOver(GOOD)

    expect((await cache.refreshKeys()).ok).toBe(true)
    expect(client.calls).toHaveLength(2)
  })

  it('reports a key set that stops being readable, keeping the old one uncommitted', async () => {
    const answers: Record<string, OutboundResponse> = {
      [discoveryUrl(ISSUER)]: { status: 200, body: document() },
      [`${ISSUER}/jwks`]: { status: 200, body: KEYS },
    }
    const { cache, clock } = cacheOver(answers, { minRefreshIntervalMs: 0 })
    await cache.get()
    answers[`${ISSUER}/jwks`] = { status: 500, body: '' }
    clock.advance(1)

    expect(await cache.refreshKeys()).toEqual({ ok: false, detail: 'the key set answered 500' })
  })

  it.each([
    [
      'discovery does not answer 200',
      { [discoveryUrl(ISSUER)]: { status: 503, body: '' } },
      'discovery answered 503',
    ],
    [
      'discovery is not JSON',
      { [discoveryUrl(ISSUER)]: { status: 200, body: 'nope' } },
      'the discovery document is not a JSON object',
    ],
    [
      'discovery is a JSON array',
      { [discoveryUrl(ISSUER)]: { status: 200, body: '[]' } },
      'the discovery document is not a JSON object',
    ],
    [
      'the document declares another issuer',
      { [discoveryUrl(ISSUER)]: { status: 200, body: document({ issuer: 'https://elsewhere' }) } },
      'the discovery document declares a different issuer',
    ],
    [
      'an endpoint is missing',
      { [discoveryUrl(ISSUER)]: { status: 200, body: document({ token_endpoint: undefined }) } },
      'the discovery document is missing an endpoint',
    ],
    [
      'an endpoint is not absolute',
      { [discoveryUrl(ISSUER)]: { status: 200, body: document({ jwks_uri: '/jwks' }) } },
      'jwks_uri is not an absolute URL',
    ],
    [
      'an endpoint downgrades to plain http',
      {
        [discoveryUrl(ISSUER)]: {
          status: 200,
          body: document({ token_endpoint: 'http://tokens.example.com/token' }),
        },
      },
      "token_endpoint does not use the issuer's own scheme",
    ],
    [
      'the key set is not JSON',
      { ...GOOD, [`${ISSUER}/jwks`]: { status: 200, body: 'nope' } },
      'the key set is not a JSON object',
    ],
    [
      'the key set is empty',
      { ...GOOD, [`${ISSUER}/jwks`]: { status: 200, body: '{"keys":[]}' } },
      'the key set has no keys',
    ],
    [
      'the key set holds something that is not a key',
      { ...GOOD, [`${ISSUER}/jwks`]: { status: 200, body: '{"keys":["nope"]}' } },
      'the key set holds something that is not a key',
    ],
  ])('refuses when %s', async (_name, answers, detail) => {
    const { cache } = cacheOver(answers as Record<string, OutboundResponse>)
    expect(await cache.get()).toEqual({ ok: false, detail })
  })

  it('reports a provider it cannot reach at all, without leaking a stack', async () => {
    const { cache } = cacheOver({
      [discoveryUrl(ISSUER)]: () => {
        throw new OutboundRequestError('timeout', 'too slow')
      },
    })

    expect(await cache.get()).toEqual({
      ok: false,
      detail: 'discovery could not be read: too slow',
    })
  })
})

describe('the error-detail helper', () => {
  it('reads a message off an Error and stringifies anything else', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
    expect(describeError('boom')).toBe('boom')
  })
})
