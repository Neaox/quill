import fastifyRateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify'

import type { MagicLinkPurpose } from '@quill/application'

import type { RateLimiter } from '../auth/rate-limit.ts'
import type { RateLimitConfig } from '../config.ts'
import { rateLimited } from '../errors.ts'

/**
 * `@fastify/rate-limit` wired to the backing-off limiter in
 * `auth/rate-limit.ts` (ADR-011).
 *
 * Two dimensions are limited on every sensitive auth endpoint, because
 * either alone is easy to route around: `addressRateLimit` keys on the
 * source address, and `accountRateLimit` keys on the account the body names,
 * so neither a password spray across addresses nor a brute force against one
 * account gets a free run.
 */

declare module 'fastify' {
  interface FastifyInstance {
    /** Told about every key that spends its budget, so the outcome is audited. */
    readonly onRateLimitExceeded: (request: FastifyRequest, key: string) => void
  }
}

export interface RateLimitOptions {
  readonly limiter: RateLimiter
  readonly config: RateLimitConfig
  /** Called with the key whenever a limit is hit, so the outcome is audited. */
  readonly onExceeded?: (request: FastifyRequest, key: string) => void
}

export function registerRateLimiting(app: FastifyInstance, options: RateLimitOptions): void {
  const onExceeded = options.onExceeded ?? ((): void => {})
  app.decorate('onRateLimitExceeded', onExceeded)

  app.register(fastifyRateLimit, {
    // Only the routes that ask for it, and only after the body is parsed, so
    // a key generator can read the account the request is about.
    global: false,
    hook: 'preHandler',
    store: options.limiter.store,
    max: options.config.max,
    timeWindow: options.config.windowMs,
    onExceeded,
    // Thrown by the plugin, so it lands in the one error handler and answers
    // in the same `{ error: { code, message, details } }` shape as everything else.
    errorResponseBuilder: (_request, context) => rateLimited(context.ttl),
  })
}

/**
 * The bucket a link request counts against: the *purpose*, not the route.
 *
 * Two routes used to be able to send a person the same kind of mail with a
 * budget each (review finding M7), which is twice the mail bomb for the same
 * effort. Keying on what the request achieves rather than on where it
 * arrived means adding a third route adds no budget.
 */
export function linkBucket(purpose: MagicLinkPurpose): string {
  return `link:${purpose}`
}

/** The exact key `addressRateLimit` counts under, so a success can clear it. */
export function addressKey(bucket: string, request: FastifyRequest): string {
  return `${bucket}:address:${request.ip}`
}

/** The exact key `accountRateLimit` counts under, so a success can clear it. */
export function accountKey(bucket: string, account: string): string {
  return `${bucket}:account:${account.toLowerCase()}`
}

/** Route-level `config.rateLimit`: one bucket per endpoint, keyed by source address. */
export function addressRateLimit(bucket: string): { readonly rateLimit: object } {
  return {
    rateLimit: {
      keyGenerator: (request: FastifyRequest) => addressKey(bucket, request),
    },
  }
}

/**
 * Route-level `config.rateLimit` for a signed-in endpoint with a budget of
 * its own: one bucket, keyed by the person behind the session rather than by
 * the address, so an office behind one address is not one budget between
 * them. `max` overrides the plugin's default for this route only; the window
 * is the limiter's, so an exhausted budget still backs off the way every
 * other one does.
 */
export function sessionRateLimit(bucket: string, max: number): { readonly rateLimit: object } {
  return {
    rateLimit: { max, keyGenerator: (request: FastifyRequest) => sessionKey(bucket, request) },
  }
}

/**
 * The exact key `sessionRateLimit` counts under. A request with no session
 * falls back to its address: every route that uses this requires a session, so
 * that is a defence rather than a path — but a budget that silently became one
 * shared bucket for every anonymous caller would be no budget at all.
 */
export function sessionKey(bucket: string, request: FastifyRequest): string {
  return `${bucket}:session:${request.session?.userId ?? request.ip}`
}

/**
 * A `preHandler` that counts against a **different limiter** from the auth
 * endpoints' (ADR-011; see `ServerConfig.oidcRateLimit` for why single
 * sign-on needs its own budget).
 *
 * Written against the limiter rather than through `@fastify/rate-limit`
 * because the plugin gives every route a `child` of the *one* store it was
 * registered with: a route-level `store` is merged into the parameters and
 * then never instantiated, so asking for a second limiter that way silently
 * counts against the first. The refusal is still the platform's — the same
 * `rateLimited` error shape, and the same audit hook every other limited
 * route reports through.
 */
export function flatAddressRateLimit(
  bucket: string,
  limiter: RateLimiter,
  config: RateLimitConfig,
): preHandlerHookHandler {
  return async function flatAddressRateLimitHook(this: FastifyInstance, request): Promise<void> {
    const key = addressKey(bucket, request)
    const decision = limiter.hit(key)
    if (decision.current > config.max) {
      this.onRateLimitExceeded(request, key)
      throw rateLimited(decision.ttl)
    }
  }
}

export interface AccountKeyOf {
  (request: FastifyRequest): string | undefined
}

/**
 * The account an unauthenticated endpoint is acting on: the email in the
 * body. Every route that uses this validates `email` by schema first, so the
 * guards here are for the shape, not for trust.
 */
export function accountKeyFromEmail(request: FastifyRequest): string | undefined {
  const body: unknown = request.body
  if (typeof body !== 'object' || body === null) return undefined
  const email = (body as { email?: unknown }).email
  return typeof email === 'string' ? email : undefined
}

/** The account an authenticated endpoint is acting on: whoever is signed in. */
export function accountKeyFromSession(request: FastifyRequest): string | undefined {
  return request.session?.userId
}

/**
 * A `preHandler` limiting the account a request names, independently of
 * where it came from. The key is lower-cased so casing cannot multiply an
 * attacker's budget, and a request that names no account is not limited on
 * this dimension at all — the address limit still applies.
 */
export function accountRateLimit(
  bucket: string,
  accountKeyOf: AccountKeyOf,
): preHandlerHookHandler {
  // The hook below refuses to run at all when there is no account, so the
  // generator is only ever asked about a request that has one.
  const keyGenerator = (request: FastifyRequest): string =>
    accountKey(bucket, String(accountKeyOf(request)))

  let check: ReturnType<FastifyInstance['createRateLimit']> | undefined

  return async function accountRateLimitHook(this: FastifyInstance, request): Promise<void> {
    if (accountKeyOf(request) === undefined) return
    check ??= this.createRateLimit({ keyGenerator })
    const result = await check(request)
    // `isAllowed` is only true for an allow-listed key; what decides a
    // refusal is whether this key has spent its budget for the window.
    if (!result.isAllowed && result.isExceeded) {
      this.onRateLimitExceeded(request, result.key)
      throw rateLimited(result.ttl)
    }
  }
}
