import fastify from 'fastify'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { describe, expect, it } from 'vitest'

import { AppError } from '../errors.ts'
import { registerErrorHandler } from './error-handler.ts'

function buildTestApp() {
  const app = fastify({ logger: false, bodyLimit: 64 }).withTypeProvider<TypeBoxTypeProvider>()
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
  app.delete('/resource', async () => ({ ok: true }))
  app.post('/echo', async () => ({ ok: true }))
  app.get('/teapot', async () => {
    throw Object.assign(new Error('I am a teapot: secret detail'), { statusCode: 418 })
  })
  app.get('/unnamed', async () => {
    throw Object.assign(new Error('closed'), { statusCode: 499 })
  })
  app.get('/unavailable', async () => {
    throw Object.assign(new Error('pool exhausted'), { statusCode: 503 })
  })
  app.post('/validated', { schema: { body: Type.Object({ name: Type.String() }) } }, async () => ({
    ok: true,
  }))

  app.post(
    '/formatted',
    {
      schema: {
        body: Type.Object({
          email: Type.String({ format: 'email' }),
          address: Type.Object({ postcode: Type.String({ minLength: 3 }) }),
        }),
      },
    },
    async () => ({ ok: true }),
  )

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

  it('names the fields at fault in the message, not the validator’s phrasing', async () => {
    const missing = await app.inject({ method: 'POST', url: '/validated', payload: {} })
    expect(missing.json().error.message).toBe('The request was not valid: name.')

    const wrong = await app.inject({
      method: 'POST',
      url: '/formatted',
      payload: { email: 'nope', address: { postcode: 'xyz' } },
    })
    expect(wrong.json().error.message).toBe('The request was not valid: email.')

    const nested = await app.inject({
      method: 'POST',
      url: '/formatted',
      payload: { email: 'a@example.com', address: { postcode: 'x' } },
    })
    expect(nested.json().error.message).toBe('The request was not valid: address.postcode.')
  })

  it('adds a missing property to the object it is missing from', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/formatted',
      payload: { email: 'a@example.com', address: {} },
    })

    expect(response.json().error.message).toBe('The request was not valid: address.postcode.')
  })

  it('says only that the request was not valid when no field is at fault', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/validated',
      headers: { 'content-type': 'application/json' },
      payload: '"not an object"',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toBe('The request was not valid.')
  })

  it('keeps the validator’s own findings in details, for a client that wants them', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/formatted',
      payload: { email: 'nope', address: { postcode: 'xyz' } },
    })

    expect(response.json().error.details).toEqual([
      expect.objectContaining({
        instancePath: '/email',
        keyword: 'format',
        params: { format: 'email' },
      }),
    ])
  })

  /**
   * Fastify refuses a malformed request itself, before any route runs, and
   * says which 4xx it is. That is the client's mistake, and a 500 told them
   * the platform was broken instead.
   */
  it('keeps the status of a request Fastify refused', async () => {
    const unsupported = await app.inject({
      method: 'DELETE',
      url: '/resource',
      headers: { 'content-type': '' },
      payload: 'x',
    })
    expect(unsupported.statusCode).toBe(415)
    expect(unsupported.json()).toEqual({
      error: { code: 'unsupported_media_type', message: 'Unsupported Media Type' },
    })

    const malformed = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    })
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json()).toEqual({ error: { code: 'invalid_body', message: 'Bad Request' } })

    const large = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x'.repeat(200) }),
    })
    expect(large.statusCode).toBe(413)
    expect(large.json()).toEqual({
      error: { code: 'payload_too_large', message: 'Payload Too Large' },
    })
  })

  it('answers any other 4xx with its standard phrase, never the error text', async () => {
    const response = await app.inject({ method: 'GET', url: '/teapot' })
    expect(response.statusCode).toBe(418)
    expect(response.json()).toEqual({ error: { code: 'bad_request', message: "I'm a Teapot" } })
  })

  it('says Bad Request for a 4xx that has no standard phrase', async () => {
    const response = await app.inject({ method: 'GET', url: '/unnamed' })
    expect(response.statusCode).toBe(499)
    expect(response.json()).toEqual({ error: { code: 'bad_request', message: 'Bad Request' } })
  })

  it('keeps a 5xx a generic 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/unavailable' })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: { code: 'internal_error', message: 'Internal Server Error' },
    })
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
