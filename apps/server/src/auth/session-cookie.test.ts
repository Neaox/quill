import fastifyCookie from '@fastify/cookie'
import fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  clearLinkCookie,
  clearSessionCookie,
  readLinkCookie,
  readSessionCookie,
  setLinkCookie,
  setSessionCookie,
} from './session-cookie.ts'

const session = {
  cookieName: 'quill_session',
  linkCookieName: 'quill_link',
  ttlMs: 60_000,
  idleTtlMs: 60_000,
  secureCookie: false,
}

function buildTestApp() {
  const app = fastify({ logger: false })
  app.register(fastifyCookie)

  app.post('/set', async (request, reply) => {
    setSessionCookie(reply, session, 'session-1', new Date('2026-01-01T00:00:00.000Z'))
    return { ok: true }
  })
  app.get('/read', async (request) => ({ token: readSessionCookie(request, session) ?? null }))
  app.post('/clear', async (request, reply) => {
    clearSessionCookie(reply, session)
    return { ok: true }
  })

  return app
}

describe('session cookie helpers', () => {
  const app = buildTestApp()

  beforeAll(async () => {
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('sets an httpOnly, SameSite=Lax cookie with the configured name and expiry', async () => {
    const response = await app.inject({ method: 'POST', url: '/set' })
    const [cookie] = response.cookies
    expect(cookie?.name).toBe('quill_session')
    expect(cookie?.value).toBe('session-1')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
    expect(cookie?.secure).toBeFalsy()
    expect(cookie?.['path']).toBe('/')
  })

  it('reads the cookie back from a request', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/read',
      cookies: { quill_session: 'session-2' },
    })
    expect(response.json()).toEqual({ token: 'session-2' })
  })

  it('reads undefined (as null) when no cookie is present', async () => {
    const response = await app.inject({ method: 'GET', url: '/read' })
    expect(response.json()).toEqual({ token: null })
  })

  /**
   * Review finding L1. A browser matches a deletion against the attributes
   * the cookie was set with, so a `__Host-` cookie cleared without `Secure`
   * and `Path=/` is simply not deleted — and the stale cookie survives a
   * sign-out, which is the opposite of what sign-out means.
   */
  it('clears the cookie with the attributes it was set with', async () => {
    const response = await app.inject({ method: 'POST', url: '/clear' })
    const [cookie] = response.cookies
    expect(cookie?.name).toBe('quill_session')
    expect(cookie?.value).toBe('')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
    expect(cookie?.['path']).toBe('/')
  })

  it('carries Secure on a secure instance, when setting and when clearing', async () => {
    const secure = fastify({ logger: false })
    secure.register(fastifyCookie)
    const config = { ...session, cookieName: '__Host-quill_session', secureCookie: true }
    secure.post('/set', async (_request, reply) => {
      setSessionCookie(reply, config, 'session-1', new Date('2026-01-01T00:00:00.000Z'))
      return { ok: true }
    })
    secure.post('/clear', async (_request, reply) => {
      clearSessionCookie(reply, config)
      return { ok: true }
    })
    await secure.ready()

    for (const url of ['/set', '/clear']) {
      const response = await secure.inject({ method: 'POST', url })
      expect(response.cookies[0]).toMatchObject({ secure: true, path: '/', httpOnly: true })
    }
    await secure.close()
  })
})

/**
 * The "you asked for this link here" cookie (ADR-011, review finding M2):
 * short-lived, `HttpOnly`, and spent as soon as the link it binds is used.
 */
describe('link cookie helpers', () => {
  function buildLinkApp() {
    const app = fastify({ logger: false })
    app.register(fastifyCookie)
    app.post('/set', async (_request, reply) => {
      setLinkCookie(reply, session, 'binding-1', new Date('2026-01-01T00:00:00.000Z'))
      return { ok: true }
    })
    app.get('/read', async (request) => ({ binding: readLinkCookie(request, session) ?? null }))
    app.post('/clear', async (_request, reply) => {
      clearLinkCookie(reply, session)
      return { ok: true }
    })
    return app
  }

  it('sets, reads and clears a short-lived HttpOnly cookie', async () => {
    const app = buildLinkApp()
    await app.ready()

    const set = await app.inject({ method: 'POST', url: '/set' })
    const [cookie] = set.cookies
    expect(cookie?.name).toBe('quill_link')
    expect(cookie?.value).toBe('binding-1')
    expect(cookie?.httpOnly).toBe(true)
    // It cannot outlive the link it binds, which is fifteen minutes.
    expect(cookie?.expires).toEqual(new Date('2026-01-01T00:15:00.000Z'))

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/read',
          cookies: { quill_link: 'binding-1' },
        })
      ).json(),
    ).toEqual({ binding: 'binding-1' })
    expect((await app.inject({ method: 'GET', url: '/read' })).json()).toEqual({ binding: null })
    expect((await app.inject({ method: 'POST', url: '/clear' })).cookies[0]?.value).toBe('')

    await app.close()
  })
})
