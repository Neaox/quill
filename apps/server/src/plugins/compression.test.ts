import { brotliDecompressSync, gunzipSync } from 'node:zlib'

import { Readable } from 'node:stream'

import fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { negotiateEncoding, registerCompression } from './compression.ts'

const LARGE = { items: Array.from({ length: 2_000 }, (_, index) => ({ id: index, title: 'x' })) }

function app() {
  const server = fastify()
  registerCompression(server)
  server.get('/large', async () => LARGE)
  server.get('/small', async () => ({ ok: true }))
  server.get('/cookie', async (_request, reply) => {
    void reply.header('set-cookie', 'session=secret; HttpOnly')
    return LARGE
  })
  server.get('/no-store', async (_request, reply) => {
    void reply.header('cache-control', 'no-store')
    return LARGE
  })
  server.post('/echo', async () => LARGE)
  server.get('/varies', async (request, reply) => {
    void reply.header('vary', String(request.headers['x-vary']))
    return LARGE
  })
  server.get('/empty', async (_request, reply) => reply.send())
  server.get('/text-buffer', async (_request, reply) => {
    void reply.type('text/plain')
    return Buffer.from(JSON.stringify(LARGE))
  })
  server.get('/stream', async (_request, reply) => {
    void reply.type('text/plain')
    return reply.send(Readable.from([JSON.stringify(LARGE)]))
  })
  server.get('/binary', async (_request, reply) => {
    void reply.type('image/png')
    return Buffer.alloc(4_096)
  })
  return server
}

describe('negotiateEncoding', () => {
  it('prefers brotli, then gzip, and honours q=0', () => {
    expect(negotiateEncoding('gzip, deflate, br')).toBe('br')
    expect(negotiateEncoding('gzip')).toBe('gzip')
    expect(negotiateEncoding('br;q=0, gzip')).toBe('gzip')
    expect(negotiateEncoding('identity')).toBeUndefined()
    expect(negotiateEncoding(undefined)).toBeUndefined()
  })
})

describe('registerCompression', () => {
  it('compresses a large JSON response with brotli when asked, and says it varies', async () => {
    const response = await app().inject({
      url: '/large',
      headers: { 'accept-encoding': 'gzip, br' },
    })

    expect(response.headers['content-encoding']).toBe('br')
    expect(response.headers['vary']).toContain('accept-encoding')
    expect(response.rawPayload.length).toBeLessThan(JSON.stringify(LARGE).length / 10)
    expect(JSON.parse(brotliDecompressSync(response.rawPayload).toString())).toEqual(LARGE)
  })

  it('falls back to gzip', async () => {
    const response = await app().inject({ url: '/large', headers: { 'accept-encoding': 'gzip' } })

    expect(response.headers['content-encoding']).toBe('gzip')
    expect(JSON.parse(gunzipSync(response.rawPayload).toString())).toEqual(LARGE)
  })

  it('leaves alone what is small, unasked for, or not text', async () => {
    const server = app()
    for (const [url, encoding] of [
      ['/small', 'br'],
      ['/large', 'identity'],
      ['/binary', 'br'],
    ] as const) {
      const response = await server.inject({ url, headers: { 'accept-encoding': encoding } })
      expect(response.headers['content-encoding']).toBeUndefined()
    }
  })

  it('never compresses a response that sets a cookie or is marked no-store, or a write', async () => {
    // BREACH: a secret and attacker-influenced text compressed together leak
    // the secret through the size. Reads that cache are what is worth
    // compressing; anything carrying a credential is left as it is.
    const server = app()
    for (const [method, url] of [
      ['GET', '/cookie'],
      ['GET', '/no-store'],
      ['POST', '/echo'],
    ] as const) {
      const response = await server.inject({ method, url, headers: { 'accept-encoding': 'br' } })
      expect(response.headers['content-encoding']).toBeUndefined()
    }
  })

  it('adds itself to what a response already varies on, once', async () => {
    const server = app()
    const varies = async (existing: string) =>
      (
        await server.inject({
          url: '/varies',
          headers: { 'accept-encoding': 'br', 'x-vary': existing },
        })
      ).headers['vary']

    expect(await varies('origin')).toBe('origin, accept-encoding')
    expect(await varies('Origin, Accept-Encoding')).toBe('Origin, Accept-Encoding')
  })

  it('leaves alone a response with no body to say the type of', async () => {
    const response = await app().inject({ url: '/empty', headers: { 'accept-encoding': 'br' } })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-encoding']).toBeUndefined()
  })

  it('compresses text it is handed as bytes, and passes a stream through as it streams', async () => {
    const server = app()
    const bytes = await server.inject({
      url: '/text-buffer',
      headers: { 'accept-encoding': 'gzip' },
    })
    expect(bytes.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(bytes.rawPayload).toString()).toBe(JSON.stringify(LARGE))

    const streamed = await server.inject({ url: '/stream', headers: { 'accept-encoding': 'gzip' } })
    expect(streamed.headers['content-encoding']).toBeUndefined()
    expect(streamed.body).toBe(JSON.stringify(LARGE))
  })
})

/** An `onSend` hook that gives the response a session cookie. */
async function setCookie(
  _request: unknown,
  reply: { header(name: string, value: string): unknown },
  payload: unknown,
): Promise<unknown> {
  reply.header('set-cookie', 'session=secret; HttpOnly')
  return payload
}

describe('registerCompression, with validators', () => {
  const TAG = '"abc123"'

  function tagged() {
    const server = fastify()
    registerCompression(server)
    // A route that answers its own conditional, as the cached reads do.
    server.get('/tagged', async (request, reply) => {
      void reply.header('etag', TAG)
      if (request.headers['if-none-match'] === TAG) return reply.status(304).send()
      return LARGE
    })
    server.get('/weak', async (request, reply) => {
      void reply.header('etag', `W/${TAG}`)
      // A route that answers any encoded form of its tag, as a weak match would.
      if (request.headers['if-none-match'] === TAG) return reply.status(304).send()
      return LARGE
    })
    return server
  }

  it('gives each encoding of a strongly tagged response its own validator', async () => {
    const server = tagged()
    const br = await server.inject({ url: '/tagged', headers: { 'accept-encoding': 'br' } })
    const gzip = await server.inject({ url: '/tagged', headers: { 'accept-encoding': 'gzip' } })
    const plain = await server.inject({ url: '/tagged' })

    expect(br.headers['etag']).toBe('"abc123-br"')
    expect(gzip.headers['etag']).toBe('"abc123-gzip"')
    expect(plain.headers['etag']).toBe(TAG)
    // A weak validator already promises only equivalence, so it is left as it is.
    const weak = await server.inject({ url: '/weak', headers: { 'accept-encoding': 'br' } })
    expect(weak.headers['content-encoding']).toBe('br')
    expect(weak.headers['etag']).toBe(`W/${TAG}`)
  })

  it('answers 304 to the validator of the encoding it would send, and the whole body to another', async () => {
    const server = tagged()
    const again = await server.inject({
      url: '/tagged',
      headers: { 'accept-encoding': 'br', 'if-none-match': '"abc123-br"' },
    })
    expect(again.statusCode).toBe(304)
    expect(again.headers['etag']).toBe('"abc123-br"')

    const otherEncoding = await server.inject({
      url: '/tagged',
      headers: { 'accept-encoding': 'gzip', 'if-none-match': '"abc123-br"' },
    })
    expect(otherEncoding.statusCode).toBe(200)
    expect(otherEncoding.headers['etag']).toBe('"abc123-gzip"')

    const identity = await server.inject({ url: '/tagged', headers: { 'if-none-match': TAG } })
    expect(identity.statusCode).toBe(304)
    expect(identity.headers['etag']).toBe(TAG)

    // A weak validator has no encoded form, so a 304 for it carries it as it is.
    const weak = await server.inject({
      url: '/weak',
      headers: { 'accept-encoding': 'br', 'if-none-match': '"abc123-br"' },
    })
    expect(weak.statusCode).toBe(304)
    expect(weak.headers['etag']).toBe(`W/${TAG}`)
  })

  it('keeps every value of a Vary it is handed as a list', async () => {
    const server = fastify()
    registerCompression(server)
    server.get('/list', async (_request, reply) => {
      void reply.header('vary', ['origin', 'cookie'])
      return LARGE
    })
    const response = await server.inject({ url: '/list', headers: { 'accept-encoding': 'br' } })
    expect(response.headers['vary']).toBe('origin, cookie, accept-encoding')
  })

  it('never compresses a response a hook registered after it gives a cookie', async () => {
    const server = fastify()
    registerCompression(server)
    server.register(async (scoped) => {
      scoped.addHook('onSend', setCookie)
      scoped.get('/scoped', async () => LARGE)
    })
    server.register(async (scoped) => {
      scoped.get('/root', async () => LARGE)
    })
    server.addHook('onSend', async (request, reply, payload) =>
      request.url === '/root' ? setCookie(request, reply, payload) : payload,
    )

    for (const url of ['/scoped', '/root']) {
      const response = await server.inject({ url, headers: { 'accept-encoding': 'br' } })
      expect(response.headers['set-cookie']).toBeDefined()
      expect(response.headers['content-encoding']).toBeUndefined()
    }
  })
})
