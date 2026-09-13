import fastifyCookie from '@fastify/cookie'
import fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SessionConfig } from '../../config.ts'
import {
  OIDC_COOKIE_TTL_MS,
  clearOidcCookie,
  readOidcCookie,
  safeReturnPath,
  setOidcCookie,
} from './state-cookie.ts'
import type { OidcSignInState } from './state-cookie.ts'

const session: SessionConfig = {
  cookieName: 'quill_session',
  linkCookieName: 'quill_link',
  oidcCookieName: 'quill_oidc',
  ttlMs: 60_000,
  idleTtlMs: 60_000,
  secureCookie: false,
}

const NOW = new Date('2026-01-01T00:00:00.000Z')

const STATE: OidcSignInState = {
  providerId: 'entra',
  state: 'the-state',
  nonce: 'the-nonce',
  codeVerifier: 'the-verifier',
  returnTo: '/w/engineering',
}

function buildTestApp() {
  const app = fastify({ logger: false })
  app.register(fastifyCookie)

  app.get('/set', async (_request, reply) => {
    setOidcCookie(reply, session, STATE, NOW)
    return { ok: true }
  })
  app.get('/read', async (request) => ({ held: readOidcCookie(request, session) }))
  app.get('/clear', async (_request, reply) => {
    clearOidcCookie(reply, session)
    return { ok: true }
  })

  return app
}

describe('the OIDC state cookie', () => {
  const app = buildTestApp()

  beforeAll(async () => {
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('is HttpOnly, SameSite=Lax, and lives ten minutes', async () => {
    const response = await app.inject({ method: 'GET', url: '/set' })

    const [cookie] = response.cookies
    expect(cookie?.name).toBe('quill_oidc')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
    expect(cookie?.['path']).toBe('/')
    expect(cookie?.expires).toEqual(new Date(NOW.getTime() + OIDC_COOKIE_TTL_MS))
    expect(OIDC_COOKIE_TTL_MS).toBe(10 * 60 * 1000)
  })

  it('round-trips the whole attempt', async () => {
    const set = await app.inject({ method: 'GET', url: '/set' })
    const value = set.cookies[0]?.value ?? ''

    const read = await app.inject({
      method: 'GET',
      url: '/read',
      cookies: { quill_oidc: value },
    })

    expect(read.json()).toEqual({ held: STATE })
  })

  it('reads nothing when there is no cookie', async () => {
    const read = await app.inject({ method: 'GET', url: '/read' })
    expect(read.json()).toEqual({ held: null })
  })

  it.each([
    ['not base64url JSON', 'not-base64url-json'],
    ['a JSON array', Buffer.from('[]', 'utf8').toString('base64url')],
    [
      'an object missing a field',
      Buffer.from(JSON.stringify({ providerId: 'entra' }), 'utf8').toString('base64url'),
    ],
    [
      'an object whose fields are not strings',
      Buffer.from(JSON.stringify({ ...STATE, state: 7 }), 'utf8').toString('base64url'),
    ],
  ])('reads nothing from a cookie that is %s', async (_name, value) => {
    const read = await app.inject({ method: 'GET', url: '/read', cookies: { quill_oidc: value } })
    expect(read.json()).toEqual({ held: null })
  })

  it('clears with the same attributes it was set with, or the browser keeps it', async () => {
    const response = await app.inject({ method: 'GET', url: '/clear' })
    const [cookie] = response.cookies
    expect(cookie?.name).toBe('quill_oidc')
    expect(cookie?.value).toBe('')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
    expect(cookie?.['path']).toBe('/')
  })
})

describe('safeReturnPath', () => {
  it.each([
    ['/w/engineering', '/w/engineering'],
    ['/w/engineering?tab=history', '/w/engineering?tab=history'],
    // Everything below is an open redirect: a freshly signed-in person landing
    // on a page that is not this application.
    ['//evil.example/', '/'],
    ['/\\evil.example/', '/'],
    ['https://evil.example/', '/'],
    ['javascript:alert(1)', '/'],
    ['w/engineering', '/'],
  ])('turns %s into %s', (candidate, expected) => {
    expect(safeReturnPath(candidate)).toBe(expected)
  })

  it('is the home page when nothing was asked for', () => {
    expect(safeReturnPath(undefined)).toBe('/')
  })
})
