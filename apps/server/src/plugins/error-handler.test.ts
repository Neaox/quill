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
})
