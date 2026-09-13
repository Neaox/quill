import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'

import { registerSecurityHeaders } from './security-headers.ts'

async function buildTestApp(options: {
  https: boolean
  serveApiDocs: boolean
}): Promise<FastifyInstance> {
  const app = fastify({ logger: false })
  registerSecurityHeaders(app, options)
  app.get('/thing', async (_request, reply) => ({ nonce: reply.cspNonce.script }))
  app.get('/api/docs/', async () => ({ ok: true }))
  await app.ready()
  return app
}

describe('registerSecurityHeaders', () => {
  it('sets a strict, nonce-based CSP with no unsafe directives', async () => {
    const app = await buildTestApp({ https: true, serveApiDocs: false })
    const response = await app.inject({ method: 'GET', url: '/thing' })
    const csp = response.headers['content-security-policy'] as string

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    await app.close()
  })

  it('mints a per-response nonce and exposes it to the renderer as reply.cspNonce', async () => {
    const app = await buildTestApp({ https: true, serveApiDocs: false })
    const first = await app.inject({ method: 'GET', url: '/thing' })
    const second = await app.inject({ method: 'GET', url: '/thing' })

    const nonce = first.json().nonce as string
    expect(nonce).toBeTruthy()
    expect(first.headers['content-security-policy']).toContain(`'nonce-${nonce}'`)
    expect(second.json().nonce).not.toBe(nonce)
    await app.close()
  })

  it('sets the rest of the header set ADR-011 names', async () => {
    const app = await buildTestApp({ https: true, serveApiDocs: false })
    const { headers } = await app.inject({ method: 'GET', url: '/thing' })

    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
    await app.close()
  })

  it('asserts HSTS only when the app knows it is behind TLS', async () => {
    const secure = await buildTestApp({ https: true, serveApiDocs: false })
    const secureResponse = await secure.inject({ method: 'GET', url: '/thing' })
    expect(secureResponse.headers['strict-transport-security']).toContain('max-age=63072000')
    expect(secureResponse.headers['strict-transport-security']).toContain('includeSubDomains')
    await secure.close()

    const plain = await buildTestApp({ https: false, serveApiDocs: false })
    const plainResponse = await plain.inject({ method: 'GET', url: '/thing' })
    expect(plainResponse.headers['strict-transport-security']).toBeUndefined()
    await plain.close()
  })

  describe('the Swagger UI exemption', () => {
    it('relaxes the policy for the docs route when the docs are served', async () => {
      const app = await buildTestApp({ https: false, serveApiDocs: true })
      const docs = await app.inject({ method: 'GET', url: '/api/docs/' })
      expect(docs.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'")
      // Only the docs: everything else keeps the strict policy.
      const thing = await app.inject({ method: 'GET', url: '/thing' })
      expect(thing.headers['content-security-policy']).not.toContain('unsafe-inline')
      await app.close()
    })

    it('does not relax anything when the docs are not served', async () => {
      const app = await buildTestApp({ https: false, serveApiDocs: false })
      const docs = await app.inject({ method: 'GET', url: '/api/docs/' })
      expect(docs.headers['content-security-policy']).not.toContain('unsafe-inline')
      await app.close()
    })
  })
})
