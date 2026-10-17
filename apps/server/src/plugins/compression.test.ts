import { brotliDecompressSync, gunzipSync } from 'node:zlib'

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
})
