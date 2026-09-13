import fastifyCookie from '@fastify/cookie'
import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerCsrfProtection } from './csrf.ts'
import { registerErrorHandler } from './error-handler.ts'

const APP_ORIGIN = 'https://docs.example.com'
const COOKIE = '__Host-quill_session'

let app: FastifyInstance

beforeEach(async () => {
  app = fastify({ logger: false })
  app.register(fastifyCookie)
  registerErrorHandler(app)
  registerCsrfProtection(app, { appOrigin: APP_ORIGIN, cookieName: COOKIE })
  app.get('/thing', async () => ({ ok: true }))
  for (const method of ['post', 'put', 'patch', 'delete'] as const) {
    app[method]('/thing', async () => ({ ok: true }))
  }
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('registerCsrfProtection', () => {
  it('lets a safe method through with no headers at all', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/thing',
      cookies: { [COOKIE]: 'token' },
    })
    expect(response.statusCode).toBe(200)
  })

  it('accepts a same-origin browser request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/thing',
      headers: { 'sec-fetch-site': 'same-origin', origin: APP_ORIGIN },
      cookies: { [COOKIE]: 'token' },
    })
    expect(response.statusCode).toBe(200)
  })

  it('accepts sec-fetch-site: none, which is a typed URL or a bookmark', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/thing',
      headers: { 'sec-fetch-site': 'none' },
      cookies: { [COOKIE]: 'token' },
    })
    expect(response.statusCode).toBe(200)
  })

  it('rejects a cross-site request on every state-changing method', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: '/thing',
        headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
        cookies: { [COOKIE]: 'token' },
      })
      expect({ method, status: response.statusCode }).toEqual({ method, status: 403 })
      expect(response.json().error.code).toBe('cross_origin_rejected')
      expect(response.json().error.details).toEqual({ reason: 'sec-fetch-site:cross-site' })
    }
  })

  it('rejects same-site (a sibling subdomain), which is not same-origin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/thing',
      headers: { 'sec-fetch-site': 'same-site' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('rejects a mismatched Origin even when the fetch metadata looks fine', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/thing',
      headers: { 'sec-fetch-site': 'same-origin', origin: 'https://evil.example' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.details).toEqual({ reason: 'origin-mismatch' })
  })

  /**
   * The documented policy for a client that sends no fetch metadata at all.
   * `app.inject` is exactly such a client, which is why this is spelled out
   * both ways rather than left implicit.
   */
  describe('a client with no fetch metadata', () => {
    it('is allowed when it carries no session cookie', async () => {
      const response = await app.inject({ method: 'POST', url: '/thing' })
      expect(response.statusCode).toBe(200)
    })

    it('is refused when it carries a session cookie', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/thing',
        cookies: { [COOKIE]: 'token' },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.details).toEqual({ reason: 'missing-fetch-metadata' })
    })

    it('is refused on the raw Cookie header too, before anything parses it', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/thing',
        headers: { cookie: `${COOKIE}=token` },
      })
      expect(response.statusCode).toBe(403)
    })

    it('is allowed when its cookies are for something else entirely', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/thing',
        headers: { cookie: 'theme=dark' },
      })
      expect(response.statusCode).toBe(200)
    })

    it('is allowed when it sends a matching Origin, which is proof enough', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/thing',
        headers: { origin: APP_ORIGIN },
        cookies: { [COOKIE]: 'token' },
      })
      expect(response.statusCode).toBe(200)
    })
  })
})
