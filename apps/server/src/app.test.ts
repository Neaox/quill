import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BRAND } from '@quill/brand'

import { buildApp } from './app.ts'
import { createHasher } from './infrastructure/hasher.ts'
import { createDocumentFormat } from './infrastructure/markdown/document-format.ts'
import { createTokenService } from './auth/tokens.ts'
import { loadConfig } from './config.ts'
import type { AppDependencies } from './dependencies.ts'
import { createTestDatabase, type TestDatabase } from './infrastructure/db/test-database.ts'
import { createSearchService } from '@quill/search'
import { createInMemorySearchIndex } from '@quill/search/test-support'

import { createUnitOfWork } from './infrastructure/repositories/unit-of-work.ts'
import { createIdentityProviderRegistry, outboundClientFactory } from './auth/oidc/registry.ts'
import { createPasswordHasher } from './auth/password.ts'
import { createRateLimiter } from './auth/rate-limit.ts'
import {
  createFakeBreachedPasswordChecker,
  createFakeClock,
  createFakeIdGenerator,
  createInMemoryBlobStore,
  createRecordingMailer,
  inMemorySettings,
} from './test-support/fakes.ts'

/** Nothing in these tests searches; the engine is present because `AppDependencies` is one shape. */
const SEARCH_INDEX = createInMemorySearchIndex()

describe('server', () => {
  const app = buildApp({ logLevel: 'silent' })

  beforeAll(async () => {
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('reports liveness on /healthz', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', service: BRAND.slug })
  })

  it('reports readiness on /readyz', async () => {
    const response = await app.inject({ method: 'GET', url: '/readyz' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', checks: {} })
  })

  it('returns 404 as JSON for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toMatch(/application\/json/)
  })

  it('logs at info level by default', async () => {
    const defaultApp = buildApp()
    expect(defaultApp.log.level).toBe('info')
    await defaultApp.close()
  })

  it('honours an explicit log level', async () => {
    const quietApp = buildApp({ logLevel: 'error' })
    expect(quietApp.log.level).toBe('error')
    await quietApp.close()
  })
})

describe('server with dependencies', () => {
  let database: TestDatabase
  let deps: AppDependencies

  beforeAll(async () => {
    database = await createTestDatabase()
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const config = loadConfig({ CONTENT_STORE: 'memory' })
    deps = {
      uow: createUnitOfWork(database.db, database.pool, createFakeIdGenerator()),
      clock,
      ids: createFakeIdGenerator(),
      hasher: createHasher(),
      tokens: createTokenService(),
      shareLinkPolicy: { allowed: () => true },
      ...(await inMemorySettings(clock, config)),
      blobStore: createInMemoryBlobStore(),
      format: createDocumentFormat(),
      searchIndex: SEARCH_INDEX,
      search: createSearchService(SEARCH_INDEX),
      mailer: createRecordingMailer(),
      breachedPasswords: createFakeBreachedPasswordChecker(),
      rateLimiter: createRateLimiter({ clock, config: config.rateLimit }),
      oidcRateLimiter: createRateLimiter({ clock, config: config.oidcRateLimit }),
      attachmentRateLimiter: createRateLimiter({ clock, config: config.attachments.rateLimit }),
      passwords: await createPasswordHasher(),
      identityProviders: createIdentityProviderRegistry({
        providers: config.oidcProviders,
        appUrl: config.appUrl,
        createClient: outboundClientFactory,
        clock,
      }),
      config,
    }
  }, 30_000)

  afterAll(async () => {
    await database.drop()
  })

  it('registers the full route set and defaults to serving the API docs', async () => {
    const app = buildApp({ logLevel: 'silent', deps })
    await app.ready()

    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200)
    const openapi = await app.inject({ method: 'GET', url: '/api/openapi.json' })
    expect(openapi.statusCode).toBe(200)
    expect(Object.keys(openapi.json().paths)).toContain('/api/auth/sign-in')
    expect((await app.inject({ method: 'GET', url: '/api/docs' })).statusCode).toBeLessThan(400)
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401)

    await app.close()
  })

  it('does not serve the API docs when the configuration says not to', async () => {
    const app = buildApp({ logLevel: 'silent', deps, serveApiDocs: false })
    await app.ready()

    expect((await app.inject({ method: 'GET', url: '/api/docs' })).statusCode).toBe(404)
    // The description goes with it: it is the route map, and a deployment
    // publishing it unauthenticated hands over reconnaissance (ADR-011). The
    // client is generated from `app.swagger()` at build time, not from a
    // running instance, so nothing needs the route.
    expect((await app.inject({ method: 'GET', url: '/api/openapi.json' })).statusCode).toBe(404)

    await app.close()
  })
})

/**
 * Review finding H7. The rate limiter keys on `request.ip`, and ADR-011
 * assumes TLS and a proxy at the edge — so a forwarded header believed from
 * an untrusted peer is not a logging nicety, it is an unlimited budget from
 * a single host, and a hard lockout anyone can aim at a victim's address.
 */
describe('trusting what is in front of the server', () => {
  let database: TestDatabase
  let base: AppDependencies

  beforeAll(async () => {
    database = await createTestDatabase()
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const config = loadConfig({ CONTENT_STORE: 'memory' })
    base = {
      uow: createUnitOfWork(database.db, database.pool, createFakeIdGenerator()),
      clock,
      ids: createFakeIdGenerator(),
      hasher: createHasher(),
      tokens: createTokenService(),
      shareLinkPolicy: { allowed: () => true },
      ...(await inMemorySettings(clock, config)),
      blobStore: createInMemoryBlobStore(),
      format: createDocumentFormat(),
      searchIndex: SEARCH_INDEX,
      search: createSearchService(SEARCH_INDEX),
      mailer: createRecordingMailer(),
      breachedPasswords: createFakeBreachedPasswordChecker(),
      rateLimiter: createRateLimiter({ clock, config: config.rateLimit }),
      oidcRateLimiter: createRateLimiter({ clock, config: config.oidcRateLimit }),
      attachmentRateLimiter: createRateLimiter({ clock, config: config.attachments.rateLimit }),
      passwords: await createPasswordHasher(),
      identityProviders: createIdentityProviderRegistry({
        providers: config.oidcProviders,
        appUrl: config.appUrl,
        createClient: outboundClientFactory,
        clock,
      }),
      config,
    }
  }, 30_000)

  afterAll(async () => {
    await database.drop()
  })

  async function seenAddress(
    trustProxy: AppDependencies['config']['trustProxy'],
    headers: Record<string, string>,
  ): Promise<{ ip: string; requestId: string }> {
    const app = buildApp({
      logLevel: 'silent',
      deps: { ...base, config: { ...base.config, trustProxy } },
      serveApiDocs: false,
    })
    app.get('/who', async (request) => ({ ip: request.ip, requestId: request.id }))
    await app.ready()
    const response = await app.inject({ method: 'GET', url: '/who', headers })
    await app.close()
    return response.json() as { ip: string; requestId: string }
  }

  const forwarded = { 'x-forwarded-for': '203.0.113.7', 'x-request-id': 'from-the-edge' }

  it('ignores a forwarded address and a supplied request id when nothing is trusted', async () => {
    const seen = await seenAddress(false, forwarded)
    expect(seen.ip).not.toBe('203.0.113.7')
    expect(seen.requestId).not.toBe('from-the-edge')
  })

  it('honours them when a hop count says there is a proxy', async () => {
    const seen = await seenAddress(1, forwarded)
    expect(seen.ip).toBe('203.0.113.7')
    expect(seen.requestId).toBe('from-the-edge')
  })

  it('honours them when the peer is on the list of trusted proxies', async () => {
    // `app.inject` presents itself as loopback, which is what the list names.
    const seen = await seenAddress(['127.0.0.1'], forwarded)
    expect(seen.ip).toBe('203.0.113.7')
  })
})
