import type { Clock } from '@quill/application'

import type { RateLimitConfig } from '../config.ts'

/**
 * Abuse resistance for the authentication endpoints (ADR-011).
 *
 * A hard lockout is a weapon an attacker points at a victim: fail an
 * account's sign-in five times and its owner is locked out. So this counts
 * per key and, when a key exhausts its window, makes the *next* window twice
 * as long, up to a cap. A wrong guess costs an honest person one short pause
 * and a brute-force run a doubling wait, and every key recovers on its own.
 *
 * Two dimensions are limited: the source address, and the account key an
 * endpoint is acting on (the submitted email, lower-cased). Limiting only
 * the address lets a botnet spread a password-spray across addresses;
 * limiting only the account lets one host hammer a thousand accounts.
 *
 * The shape is `@fastify/rate-limit`'s own store contract, so the plugin
 * does the HTTP work (429, `Retry-After`, the `x-ratelimit-*` headers) and a
 * test can inject this store and drive it with the fake clock.
 */

export interface RateLimitDecision {
  /** Requests made in the current window, including this one. */
  readonly current: number
  /** Milliseconds until the current window ends. */
  readonly ttl: number
}

export interface RateLimiter {
  /** Counts one request against a key and answers where that leaves it. */
  hit(key: string): RateLimitDecision
  /**
   * Where a key stands, without spending anything.
   *
   * For a budget that only accepted work consumes: the uploads limit is
   * checked before a file is read and counted only once one has been stored,
   * so a refused upload — which costs a few hundred bytes and no storage —
   * leaves an honest person's budget where it was.
   */
  peek(key: string): RateLimitDecision
  /** The window a key is currently serving, in milliseconds. */
  windowFor(key: string): number
  /**
   * Forgets a key. Called when a request succeeds (`routes/auth.ts`), so a
   * person who mistypes a password twice and then gets it right starts the
   * next hour with a full budget rather than a half-spent one.
   */
  reset(key: string): void
  /** How many keys are currently remembered. Bounded — see `sweep` below. */
  readonly size: number
  /** The plugin's store constructor, bound to this limiter. */
  readonly store: RateLimitStoreConstructor
}

/**
 * `@fastify/rate-limit` instantiates a store per route and calls `incr` with
 * a callback. It is an old-style contract; this adapts it to the limiter.
 */
export interface RateLimitStore {
  incr(key: string, callback: (error: Error | null, result: RateLimitDecision) => void): void
  child(routeOptions: unknown): RateLimitStore
}

export interface RateLimitStoreConstructor {
  new (options?: unknown): RateLimitStore
}

interface Bucket {
  count: number
  windowMs: number
  windowEndsAt: number
}

/**
 * How often the map is swept for keys nobody has come back to.
 *
 * Sweeping on every hit would be O(keys) per request; sweeping never meant
 * the map grew for ever, keyed partly by an attacker-supplied email address,
 * which is a slow memory leak anybody can drive (review finding M1). Once a
 * second is far more often than the shortest window.
 */
const SWEEP_INTERVAL_MS = 1_000

export interface RateLimiterOptions {
  readonly clock: Clock
  readonly config: RateLimitConfig
}

export function createRateLimiter({ clock, config }: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, Bucket>()
  let sweptAt = Number.NEGATIVE_INFINITY

  /**
   * Drops every key whose window ended a full maximum window ago.
   *
   * Not simply "whose window ended": the bucket is also where the backoff
   * lives, and forgetting a key the moment its window lapsed would hand a
   * key that had just been doubled to the cap a fresh base window. Waiting
   * one maximum window means the penalty has fully served its time either
   * way, so dropping the row changes no answer.
   */
  function sweep(now: number): void {
    if (now - sweptAt < SWEEP_INTERVAL_MS) return
    sweptAt = now
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowEndsAt >= config.maxWindowMs) buckets.delete(key)
    }
  }

  function bucketFor(key: string, now: number): Bucket {
    const existing = buckets.get(key)
    if (existing === undefined) {
      const fresh: Bucket = {
        count: 0,
        windowMs: config.windowMs,
        windowEndsAt: now + config.windowMs,
      }
      buckets.set(key, fresh)
      return fresh
    }
    if (now < existing.windowEndsAt) return existing

    // The window that just ended decides the next one: exhausted, double it;
    // survived, drop back to the base window.
    const nextWindowMs =
      existing.count > config.max
        ? Math.min(existing.windowMs * 2, config.maxWindowMs)
        : config.windowMs
    existing.count = 0
    existing.windowMs = nextWindowMs
    existing.windowEndsAt = now + nextWindowMs
    return existing
  }

  const limiter: RateLimiter = {
    hit(key: string): RateLimitDecision {
      const now = clock.now().getTime()
      sweep(now)
      const bucket = bucketFor(key, now)
      bucket.count += 1
      return { current: bucket.count, ttl: bucket.windowEndsAt - now }
    },

    peek(key: string): RateLimitDecision {
      const now = clock.now().getTime()
      const bucket = buckets.get(key)
      // A key nobody has spent anything on, or one whose window has lapsed,
      // has a full budget; neither creates a bucket, because asking is not
      // using and a question should not be a way to fill the map.
      if (bucket === undefined || now >= bucket.windowEndsAt) {
        return { current: 0, ttl: config.windowMs }
      }
      return { current: bucket.count, ttl: bucket.windowEndsAt - now }
    },

    windowFor(key: string): number {
      const bucket = buckets.get(key)
      return bucket === undefined ? config.windowMs : bucket.windowMs
    },

    reset(key: string): void {
      buckets.delete(key)
    },

    get size(): number {
      return buckets.size
    },

    store: class BackoffStore implements RateLimitStore {
      incr(key: string, callback: (error: Error | null, result: RateLimitDecision) => void): void {
        callback(null, limiter.hit(key))
      }

      child(): RateLimitStore {
        return this
      }
    },
  }

  return limiter
}
