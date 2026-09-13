import fastify from 'fastify'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { describe, expect, it } from 'vitest'

import { AppError } from '../errors.ts'
import { registerErrorHandler } from './error-handler.ts'

function buildTestApp() {
  const app = fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>()
  registerErrorHandler(app)

  app.get('/app-error', async () => {
    throw new AppError(423, 'lock_lost', 'no lock', { holder: 'bob' })
  })
  app.get('/app-error-no-details', async () => {
    throw new AppError(401, 'unauthenticated', 'sign in')
  })
  app.get('/boom', async () => {
    throw new Error('unexpected')
  })
  app.post('/validated', { schema: { body: Type.Object({ name: Type.String() }) } }, async () => ({
    ok: true,
  }))

  return app
}

describe('registerErrorHandler', () => {
  const app = buildTestApp()

  it('maps AppError to { error: { code, message, details } }', async () => {
    const response = await app.inject({ method: 'GET', url: '/app-error' })
    expect(response.statusCode).toBe(423)
    expect(response.json()).toEqual({
      error: { code: 'lock_lost', message: 'no lock', details: { holder: 'bob' } },
    })
  })

  it('omits details when the AppError has none', async () => {
    const response = await app.inject({ method: 'GET', url: '/app-error-no-details' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: { code: 'unauthenticated', message: 'sign in' } })
  })

  it('maps a schema validation failure to 400 validation_error', async () => {
    const response = await app.inject({ method: 'POST', url: '/validated', payload: {} })
    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body.error.code).toBe('validation_error')
    expect(Array.isArray(body.error.details)).toBe(true)
  })

  it('maps an unexpected error to a generic 500 without leaking internals', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom' })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: { code: 'internal_error', message: 'Internal Server Error' },
    })
  })

  it('reports 404 in the same error shape for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      error: { code: 'not_found', message: 'Route GET:/nope not found' },
    })
  })

  /**
   * The 404 message echoes the URL, and a share link carries its token in
   * the URL — so the two spellings that miss every route, a trailing slash
   * on the API route and the page address the browser asks for, must not
   * hand the token back in a response body (ADR-011).
   */
  it('takes a share-link token out of the URL it echoes', async () => {
    const token = 'Yb3nXq7Tz9LmK0aQw2Rd4Ef6Gh8Jk1Np3Sv5Uz7Wx9'

    for (const url of [`/api/share/${token}/`, `/share/${token}`]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode).toBe(404)
      expect(response.body).not.toContain(token)
      expect(response.json().error.message).toContain('[redacted]')
    }
  })
})
