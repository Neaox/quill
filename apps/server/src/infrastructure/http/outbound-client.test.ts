import { describe, expect, it, vi } from 'vitest'

import { OutboundRequestError, createOutboundClient, isBlockedAddress } from './outbound-client.ts'
import type { FetchLike, OutboundClientOptions } from './outbound-client.ts'

const ALLOWED = 'api.example.com'

function respond(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(status === 204 || status >= 300 ? null : body, { status, headers })
}

function setUp(overrides: Partial<OutboundClientOptions> = {}) {
  const fetchMock = vi.fn<FetchLike>(async () => respond(200, 'ok'))
  const client = createOutboundClient({
    allowedHosts: [ALLOWED],
    resolve: async () => ['93.184.216.34'],
    fetch: fetchMock,
    ...overrides,
  })
  return { client, fetchMock }
}

describe('isBlockedAddress', () => {
  it('blocks every address family that means "inside"', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // the cloud metadata service
      '100.64.0.1', // carrier-grade NAT
      '0.0.0.0',
      '192.0.0.192',
      '198.18.0.1',
      '224.0.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:169.254.169.254',
      'not-an-address',
    ]) {
      expect({ address, blocked: isBlockedAddress(address) }).toEqual({ address, blocked: true })
    }
  })

  it('allows ordinary public addresses', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1::1']) {
      expect({ address, blocked: isBlockedAddress(address) }).toEqual({ address, blocked: false })
    }
  })
})

describe('createOutboundClient', () => {
  it('fetches an allowed host and returns the body', async () => {
    const { client, fetchMock } = setUp()
    const response = await client.get({ url: `https://${ALLOWED}/range/ABCDE` })
    expect(response).toEqual({ status: 200, body: 'ok' })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://${ALLOWED}/range/ABCDE`,
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    )
  })

  it('passes the caller’s headers through', async () => {
    const { client, fetchMock } = setUp()
    await client.get({ url: `https://${ALLOWED}/x`, headers: { 'Add-Padding': 'true' } })
    expect(fetchMock.mock.calls[0]?.[1].headers).toEqual({ 'Add-Padding': 'true' })
  })

  it('refuses a host that is not on the allowlist', async () => {
    const { client, fetchMock } = setUp()
    await expect(client.get({ url: 'https://evil.example.com/x' })).rejects.toMatchObject({
      reason: 'host_not_allowed',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a scheme that is not http(s)', async () => {
    const { client } = setUp()
    await expect(client.get({ url: 'file:///etc/passwd' })).rejects.toMatchObject({
      reason: 'scheme_not_allowed',
    })
  })

  it('refuses a host that resolves to a private address, however allowed it is', async () => {
    const { client, fetchMock } = setUp({ resolve: async () => ['169.254.169.254'] })
    await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
      reason: 'private_address',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a host where only one of several addresses is private', async () => {
    const { client } = setUp({ resolve: async () => ['93.184.216.34', '10.0.0.1'] })
    await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
      reason: 'private_address',
    })
  })

  it('refuses a host that resolves to nothing', async () => {
    const { client } = setUp({ resolve: async () => [] })
    await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
      reason: 'private_address',
    })
  })

  it('refuses a host that does not resolve', async () => {
    const { client } = setUp({
      resolve: async () => {
        throw new Error('ENOTFOUND')
      },
    })
    await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
      reason: 'dns_failure',
    })
  })

  describe('redirects', () => {
    it('follows one, re-checking the host it lands on', async () => {
      const fetchMock = vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(respond(302, '', { location: `https://${ALLOWED}/moved` }))
        .mockResolvedValueOnce(respond(200, 'arrived'))
      const client = createOutboundClient({
        allowedHosts: [ALLOWED],
        resolve: async () => ['93.184.216.34'],
        fetch: fetchMock,
      })
      expect(await client.get({ url: `https://${ALLOWED}/x` })).toEqual({
        status: 200,
        body: 'arrived',
      })
    })

    /** The SSRF case the allowlist alone would miss. */
    it('refuses a redirect that leaves the allowlist', async () => {
      const fetchMock = vi
        .fn<FetchLike>()
        .mockResolvedValue(respond(302, '', { location: 'https://metadata.internal/latest' }))
      const client = createOutboundClient({
        allowedHosts: [ALLOWED],
        resolve: async () => ['93.184.216.34'],
        fetch: fetchMock,
      })
      await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
        reason: 'host_not_allowed',
      })
    })

    it('refuses a redirect to a private address on an allowed host', async () => {
      const fetchMock = vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(respond(302, '', { location: `https://${ALLOWED}/inner` }))
        .mockResolvedValueOnce(respond(200, 'never read'))
      let call = 0
      const client = createOutboundClient({
        allowedHosts: [ALLOWED],
        resolve: async () => (call++ === 0 ? ['93.184.216.34'] : ['127.0.0.1']),
        fetch: fetchMock,
      })
      await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
        reason: 'private_address',
      })
    })

    it('caps how many it will follow', async () => {
      const fetchMock = vi
        .fn<FetchLike>()
        .mockResolvedValue(respond(302, '', { location: `https://${ALLOWED}/again` }))
      const client = createOutboundClient({
        allowedHosts: [ALLOWED],
        resolve: async () => ['93.184.216.34'],
        fetch: fetchMock,
        maxRedirects: 2,
      })
      await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
        reason: 'too_many_redirects',
      })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('refuses a redirect with no Location', async () => {
      const { client } = setUp({ fetch: async () => respond(302) })
      await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
        reason: 'redirect_without_location',
      })
    })
  })

  describe('limits', () => {
    it('refuses a response whose declared length exceeds the cap', async () => {
      const { client } = setUp({
        maxResponseBytes: 10,
        fetch: async () => respond(200, 'x'.repeat(50), { 'content-length': '50' }),
      })
      await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
        reason: 'response_too_large',
      })
    })

    it('refuses a response that lies about its length', async () => {
      const { client } = setUp({
        maxResponseBytes: 10,
        fetch: async () => respond(200, 'x'.repeat(50)),
      })
      await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
        reason: 'response_too_large',
      })
    })

    it('aborts on the timeout', async () => {
      const { client } = setUp({
        timeoutMs: 5,
        fetch: (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      })
      await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
        reason: 'timeout',
      })
    })

    it('reports any other transport failure as a network error', async () => {
      const { client } = setUp({
        fetch: async () => {
          throw new Error('connection reset')
        },
      })
      await expect(client.get({ url: `https://${ALLOWED}/x` })).rejects.toMatchObject({
        reason: 'network_error',
      })
    })
  })

  it('carries its reason on a typed error', async () => {
    const { client } = setUp()
    const error = await client.get({ url: 'https://evil.example.com/x' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OutboundRequestError)
    expect((error as OutboundRequestError).name).toBe('OutboundRequestError')
  })

  it('defaults to the real DNS resolver and global fetch', async () => {
    // Nothing is fetched: the allowlist refuses first, which is enough to
    // exercise the defaulted options without touching a network.
    const client = createOutboundClient({ allowedHosts: [] })
    await expect(client.get({ url: 'https://example.com/' })).rejects.toMatchObject({
      reason: 'host_not_allowed',
    })
  })

  it('resolves a real hostname through the default resolver', async () => {
    const client = createOutboundClient({
      allowedHosts: ['localhost'],
      fetch: async () => respond(200, 'never'),
    })
    // localhost resolves to a loopback address, so the SSRF guard refuses —
    // which is exactly the default resolver doing its job.
    await expect(client.get({ url: 'http://localhost/' })).rejects.toMatchObject({
      reason: 'private_address',
    })
  })
})

describe('a response with no body', () => {
  it('reads as empty rather than failing', async () => {
    const client = createOutboundClient({
      allowedHosts: ['example.com'],
      resolve: async () => ['93.184.216.34'],
      fetch: async () => new Response(null, { status: 204 }),
    })
    expect(await client.get({ url: 'https://example.com/nothing' })).toEqual({
      status: 204,
      body: '',
    })
  })
})

/**
 * `post` is the first outbound call that is not a read (the OIDC token
 * exchange, ADR-011). It goes through the same allowlist, address check and
 * caps as `get`, and differs in exactly one rule: it never follows a
 * redirect, because doing so would replay the client secret and the
 * authorisation code at a host the caller never named.
 */
describe('post', () => {
  it('sends the body with its content type and length, to an allowed host', async () => {
    const { client, fetchMock } = setUp()

    const response = await client.post({
      url: `https://${ALLOWED}/token`,
      body: 'grant_type=authorization_code&code=abc',
      contentType: 'application/x-www-form-urlencoded',
      headers: { accept: 'application/json' },
    })

    expect(response).toEqual({ status: 200, body: 'ok' })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      body: 'grant_type=authorization_code&code=abc',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '38',
      },
    })
  })

  it('refuses a host that is not on the allowlist, before it can send a secret', async () => {
    const { client, fetchMock } = setUp()

    await expect(
      client.post({
        url: 'https://evil.example.com/token',
        body: 'client_secret=hunter2',
        contentType: 'application/x-www-form-urlencoded',
      }),
    ).rejects.toMatchObject({ reason: 'host_not_allowed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a private address, like every other outbound call', async () => {
    const { client } = setUp({ resolve: async () => ['169.254.169.254'] })

    await expect(
      client.post({
        url: `https://${ALLOWED}/token`,
        body: '',
        contentType: 'application/x-www-form-urlencoded',
      }),
    ).rejects.toMatchObject({ reason: 'private_address' })
  })

  it('does not follow a redirect: the body carries credentials', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      respond(302, '', { location: 'https://evil.example.com/collect' }),
    )
    const { client } = setUp({ fetch: fetchMock })

    await expect(
      client.post({
        url: `https://${ALLOWED}/token`,
        body: 'client_secret=hunter2',
        contentType: 'application/x-www-form-urlencoded',
      }),
    ).rejects.toMatchObject({ reason: 'redirect_not_followed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('answers with the provider’s error body rather than throwing on a 4xx', async () => {
    // Built directly rather than through `respond`, which sends no body on a
    // non-2xx: a token endpoint's refusal is exactly where the body matters.
    const { client } = setUp({
      fetch: async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
    })

    expect(
      await client.post({
        url: `https://${ALLOWED}/token`,
        body: '',
        contentType: 'application/x-www-form-urlencoded',
      }),
    ).toEqual({ status: 400, body: '{"error":"invalid_grant"}' })
  })

  it('applies the response size cap while the body arrives', async () => {
    const { client } = setUp({
      maxResponseBytes: 8,
      fetch: async () => respond(200, 'far too much to be a token response'),
    })

    await expect(
      client.post({
        url: `https://${ALLOWED}/token`,
        body: '',
        contentType: 'application/x-www-form-urlencoded',
      }),
    ).rejects.toMatchObject({ reason: 'response_too_large' })
  })
})
