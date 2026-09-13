import fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { registerOpenApi } from './openapi.ts'

describe('registerOpenApi', () => {
  it('serves the OpenAPI document at /api/openapi.json', async () => {
    const app = fastify({ logger: false })
    registerOpenApi(app, { serveUi: true })
    await app.ready()

    const response = await app.inject({ method: 'GET', url: '/api/openapi.json' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.openapi).toMatch(/^3\./)
    expect(body.info.title).toContain('API')

    await app.close()
  })

  it('names a shared schema by the id it was registered under', async () => {
    const app = fastify({ logger: false })
    registerOpenApi(app, { serveUi: true })
    app.addSchema({ $id: 'Named', type: 'object', properties: { a: { type: 'string' } } })
    await app.ready()

    const schemas = (await app.inject({ method: 'GET', url: '/api/openapi.json' })).json()
      .components.schemas
    expect(Object.keys(schemas)).toEqual(['Named'])

    await app.close()
  })

  it('serves neither the description nor the UI when the flag is off', async () => {
    const app = fastify({ logger: false })
    registerOpenApi(app, { serveUi: false })
    await app.ready()

    // The route map is reconnaissance whether or not a browser renders it,
    // so production serves neither (ADR-011).
    expect((await app.inject({ method: 'GET', url: '/api/openapi.json' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/docs' })).statusCode).toBe(404)

    await app.close()
  })

  it('serves the Swagger UI only when asked', async () => {
    const withUi = fastify({ logger: false })
    await registerOpenApi(withUi, { serveUi: true })
    await withUi.ready()
    expect((await withUi.inject({ method: 'GET', url: '/api/docs' })).statusCode).toBeLessThan(400)
    await withUi.close()

    const withoutUi = fastify({ logger: false })
    await registerOpenApi(withoutUi, { serveUi: false })
    await withoutUi.ready()
    expect((await withoutUi.inject({ method: 'GET', url: '/api/docs' })).statusCode).toBe(404)
    await withoutUi.close()
  })
})
