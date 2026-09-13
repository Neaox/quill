import fastify from 'fastify'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { describe, expect, it } from 'vitest'

import { createRateLimiter } from '../auth/rate-limit.ts'
import type { RateLimiter } from '../auth/rate-limit.ts'
import { createFakeClock } from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { registerErrorHandler } from './error-handler.ts'
import {
  accountKeyFromEmail,
  accountKeyFromSession,
  sessionKey,
  accountRateLimit,
  addressRateLimit,
  registerRateLimiting,
} from './rate-limit.ts'

const CONFIG = { max: 2, windowMs: 1_000, maxWindowMs: 8_000 }

/** The account key a body would produce, without building a whole request. */
const emailIn = (body: unknown): string | undefined =>
  accountKeyFromEmail({ body } as FastifyRequest)

/** One sign-in attempt for the same account, from a named address. */
const from = (ip: string) => ({
  method: 'POST' as const,
  url: '/sign-in',
  payload: { email: 'ada@example.com' },
  remoteAddress: ip,
})

interface Harness {
  readonly app: FastifyInstance
  readonly clock: FakeClock
  readonly limiter: RateLimiter
  readonly exceeded: string[]
}

async function buildTestApp(): Promise<Harness> {
  const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
  const limiter = createRateLimiter({ clock, config: CONFIG })
  const exceeded: string[] = []
  const app = fastify({ logger: false })
  registerErrorHandler(app)
  registerRateLimiting(app, {
    limiter,
    config: CONFIG,
    onExceeded: (_request, key) => void exceeded.push(key),
  })

  // Registered in a plugin of their own, as `app.ts` does: the limiter's
  // `onRoute` hook only exists once its plugin has loaded, so a route
  // declared on the root instance before that would never be limited.
  app.register(async (routes) => {
    routes.post(
      '/sign-in',
      {
        config: addressRateLimit('sign-in'),
        preHandler: accountRateLimit('sign-in', accountKeyFromEmail),
      },
      async () => ({ ok: true }),
    )
    routes.post('/unlimited', async () => ({ ok: true }))
  })

  await app.ready()
  return { app, clock, limiter, exceeded }
}

describe('registerRateLimiting', () => {
  it('limits only the routes that ask for it', async () => {
    const { app } = await buildTestApp()
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await app.inject({ method: 'POST', url: '/unlimited' })).statusCode).toBe(200)
    }
    await app.close()
  })

  it('answers 429 in the one error shape, with a retry hint', async () => {
    const { app } = await buildTestApp()
    const payload = { email: 'ada@example.com' }
    expect((await app.inject({ method: 'POST', url: '/sign-in', payload })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/sign-in', payload })).statusCode).toBe(200)

    const limited = await app.inject({ method: 'POST', url: '/sign-in', payload })
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('rate_limited')
    expect(limited.json().error.details.retryAfterSeconds).toBeGreaterThan(0)
    await app.close()
  })

  it('recovers once the window passes, and the next window is longer', async () => {
    const { app, clock, limiter } = await buildTestApp()
    const payload = { email: 'ada@example.com' }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await app.inject({ method: 'POST', url: '/sign-in', payload })
    }

    clock.advance(CONFIG.windowMs)
    expect((await app.inject({ method: 'POST', url: '/sign-in', payload })).statusCode).toBe(200)
    // Backoff, not lockout: the key works again, on a window twice as long.
    // The account key is the one that ran out — the refusal short-circuits
    // before the address key is counted a third time, which is the point of
    // checking the narrower dimension first.
    expect(limiter.windowFor('sign-in:account:ada@example.com')).toBe(2 * CONFIG.windowMs)
    await app.close()
  })

  it('reports every exceeded key, so the outcome can be audited', async () => {
    const { app, exceeded } = await buildTestApp()
    const payload = { email: 'ada@example.com' }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await app.inject({ method: 'POST', url: '/sign-in', payload })
    }
    expect(exceeded).toEqual(['sign-in:account:ada@example.com'])
    await app.close()
  })

  describe('the account dimension', () => {
    it('limits one account across different source addresses', async () => {
      const { app } = await buildTestApp()
      expect((await app.inject(from('10.0.0.1'))).statusCode).toBe(200)
      expect((await app.inject(from('10.0.0.2'))).statusCode).toBe(200)
      // A third address, but the same account: the address budget is fresh
      // and the account budget is not.
      expect((await app.inject(from('10.0.0.3'))).statusCode).toBe(429)
      await app.close()
    })

    it('treats an account key case-insensitively', async () => {
      const { app } = await buildTestApp()
      await app.inject({
        method: 'POST',
        url: '/sign-in',
        payload: { email: 'ada@example.com' },
        remoteAddress: '10.0.0.1',
      })
      await app.inject({
        method: 'POST',
        url: '/sign-in',
        payload: { email: 'ADA@example.com' },
        remoteAddress: '10.0.0.2',
      })
      const third = await app.inject({
        method: 'POST',
        url: '/sign-in',
        payload: { email: 'Ada@Example.com' },
        remoteAddress: '10.0.0.3',
      })
      expect(third.statusCode).toBe(429)
      await app.close()
    })

    it('does not limit a request that names no account', async () => {
      const { app } = await buildTestApp()
      for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4']) {
        const response = await app.inject({
          method: 'POST',
          url: '/sign-in',
          payload: {},
          remoteAddress: ip,
        })
        expect(response.statusCode).toBe(200)
      }
      await app.close()
    })
  })

  it('refuses on the address dimension alone, in the same shape', async () => {
    const { app } = await buildTestApp()
    // No account named, so only the address budget applies.
    for (let attempt = 0; attempt < CONFIG.max; attempt += 1) {
      expect((await app.inject({ method: 'POST', url: '/sign-in', payload: {} })).statusCode).toBe(
        200,
      )
    }
    const limited = await app.inject({ method: 'POST', url: '/sign-in', payload: {} })
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('rate_limited')
    await app.close()
  })

  it('registers without an audit sink', async () => {
    const app = fastify({ logger: false })
    registerErrorHandler(app)
    registerRateLimiting(app, {
      limiter: createRateLimiter({
        clock: createFakeClock(new Date('2026-01-01T00:00:00.000Z')),
        config: CONFIG,
      }),
      config: CONFIG,
    })
    app.register(async (routes) => {
      routes.post(
        '/x',
        {
          config: addressRateLimit('x'),
          preHandler: accountRateLimit('x', () => 'ada@example.com'),
        },
        async () => ({ ok: true }),
      )
    })
    await app.ready()
    for (let attempt = 0; attempt < CONFIG.max; attempt += 1) {
      expect((await app.inject({ method: 'POST', url: '/x' })).statusCode).toBe(200)
    }
    // The default sink is a no-op: being limited still answers 429.
    expect((await app.inject({ method: 'POST', url: '/x' })).statusCode).toBe(429)
    await app.close()
  })

  describe('the account key helpers', () => {
    it('reads the email a body names, and nothing else', () => {
      expect(emailIn({ email: 'ada@example.com' })).toBe('ada@example.com')
      expect(emailIn({ email: 42 })).toBeUndefined()
      expect(emailIn({})).toBeUndefined()
      expect(emailIn(null)).toBeUndefined()
      expect(emailIn('a string body')).toBeUndefined()
      expect(emailIn(undefined)).toBeUndefined()
    })

    it('reads the signed-in user, when there is one', () => {
      expect(
        accountKeyFromSession({ session: { userId: 'ada', sessionId: 's' } } as FastifyRequest),
      ).toBe('ada')
      expect(accountKeyFromSession({} as FastifyRequest)).toBeUndefined()
    })

    it('keys a signed-in endpoint on the person, falling back to the address', () => {
      expect(
        sessionKey('search', {
          session: { userId: 'ada', sessionId: 's' },
          ip: '203.0.113.1',
        } as FastifyRequest),
      ).toBe('search:session:ada')
      expect(sessionKey('search', { ip: '203.0.113.1' } as FastifyRequest)).toBe(
        'search:session:203.0.113.1',
      )
    })
  })
})
