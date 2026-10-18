import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'

import { EMBED_PROVIDERS } from '@quill/domain'

import { linkEmbedRegistry } from '../infrastructure/link-preview/embed-config.ts'
import { registerSecurityHeaders } from './security-headers.ts'

const ALLOWED_ORIGINS = new Set(EMBED_PROVIDERS.flatMap((provider) => provider.frameOrigins))

/** The sources a policy's `frame-src` lists. */
function frameSources(policy: string | undefined): readonly string[] {
  const directive = String(policy)
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('frame-src '))
  return directive === undefined ? [] : directive.split(/\s+/u).slice(1)
}

async function buildTestApp(options: {
  https: boolean
  serveApiDocs: boolean
  frameSources?: readonly string[]
}): Promise<FastifyInstance> {
  const app = fastify({ logger: false })
  registerSecurityHeaders(app, options)
  app.get('/thing', async (_request, reply) => ({ nonce: reply.cspNonce.script }))
  app.get('/api/docs/', async () => ({ ok: true }))
  await app.ready()
  return app
}

describe('registerSecurityHeaders', () => {
  it('frames nothing, unless configuration names the origins it may frame', async () => {
    const strict = await buildTestApp({ https: true, serveApiDocs: false })
    const framing = await buildTestApp({
      https: true,
      serveApiDocs: false,
      frameSources: ['https://draw.example.com'],
    })

    const none = (await strict.inject({ method: 'GET', url: '/thing' })).headers
    const one = (await framing.inject({ method: 'GET', url: '/thing' })).headers
    expect(none['content-security-policy']).toContain("frame-src 'none'")
    expect(one['content-security-policy']).toContain('frame-src https://draw.example.com;')
    expect(one['content-security-policy']).toContain("frame-ancestors 'none'")
    await strict.close()
    await framing.close()
  })

  describe('frame-src for link embeds (ADR-042)', () => {
    async function policyFor(disabled: readonly string[]) {
      const app = await buildTestApp({
        https: true,
        serveApiDocs: false,
        frameSources: linkEmbedRegistry({ disabled }).frameSources(),
      })
      const response = await app.inject({ method: 'GET', url: '/thing' })
      await app.close()
      return response.headers['content-security-policy']
    }

    it('names exactly the allowlisted origins, each as an https origin, and nothing else', async () => {
      const sources = frameSources(String(await policyFor([])))
      expect(new Set(sources)).toEqual(ALLOWED_ORIGINS)
      for (const source of sources) {
        expect(source).toMatch(/^https:\/\/[a-z0-9.-]+$/u)
        expect(source).not.toContain('*')
      }
    })

    it('allows no frame source at all once every provider is switched off', async () => {
      const policy = String(await policyFor(EMBED_PROVIDERS.map((provider) => provider.id)))
      expect(policy).toContain("frame-src 'none'")
    })

    it('drops the origin of a provider an operator disabled, and only that one', async () => {
      const sources = frameSources(String(await policyFor(['youtube'])))
      expect(sources).not.toContain('https://www.youtube-nocookie.com')
      expect(sources).toContain('https://player.vimeo.com')
    })

    it('does not widen any other fetch directive to make the frames work', async () => {
      const policy = String(await policyFor([]))
      expect(policy).toContain("default-src 'self'")
      expect(policy).toContain("connect-src 'self'")
      expect(policy).toContain("script-src 'self'")
      expect(policy).not.toMatch(/(?:script|style|connect|img|media|default)-src[^;]*youtube/u)
      expect(policy).toContain("frame-ancestors 'none'")
    })
  })

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
