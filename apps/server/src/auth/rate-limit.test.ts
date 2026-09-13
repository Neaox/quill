import { describe, expect, it } from 'vitest'

import { createFakeClock } from '../test-support/fakes.ts'
import { createRateLimiter } from './rate-limit.ts'

const CONFIG = { max: 3, windowMs: 1_000, maxWindowMs: 8_000 }

function setUp() {
  const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
  return { clock, limiter: createRateLimiter({ clock, config: CONFIG }) }
}

/**
 * Review finding M1: the map grew without bound, keyed partly by an
 * attacker-supplied email address, which is a memory leak anybody can drive.
 */
describe('the bounded store', () => {
  it('forgets a key nobody has come back to, once its penalty could not still be running', () => {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const limiter = createRateLimiter({
      clock,
      config: { max: 2, windowMs: 1_000, maxWindowMs: 8_000 },
    })

    for (let i = 0; i < 50; i += 1) limiter.hit(`spray-${i}@example.com`)
    expect(limiter.size).toBe(50)

    // A sweep runs at most once a second, so nothing is dropped immediately.
    clock.advance(500)
    limiter.hit('someone@example.com')
    expect(limiter.size).toBe(51)

    // Past the window *and* a full maximum window: even a key that had been
    // doubled to the cap has served its penalty, so dropping it changes no
    // answer.
    clock.advance(1_000 + 8_000)
    limiter.hit('someone@example.com')
    expect(limiter.size).toBe(1)
  })

  it('keeps a key whose penalty window has not run out', () => {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const limiter = createRateLimiter({
      clock,
      config: { max: 2, windowMs: 1_000, maxWindowMs: 8_000 },
    })
    limiter.hit('ada@example.com')
    clock.advance(2_000)
    limiter.hit('bob@example.com')
    expect(limiter.size).toBe(2)
  })

  it('forgets a key outright when a request on it succeeds', () => {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const limiter = createRateLimiter({
      clock,
      config: { max: 2, windowMs: 1_000, maxWindowMs: 8_000 },
    })
    limiter.hit('ada@example.com')
    expect(limiter.size).toBe(1)
    limiter.reset('ada@example.com')
    expect(limiter.size).toBe(0)
  })
})

describe('createRateLimiter', () => {
  it('counts requests within a window and reports the time left in it', () => {
    const { clock, limiter } = setUp()
    expect(limiter.hit('a')).toEqual({ current: 1, ttl: 1_000 })
    clock.advance(400)
    expect(limiter.hit('a')).toEqual({ current: 2, ttl: 600 })
  })

  it('keeps keys apart', () => {
    const { limiter } = setUp()
    limiter.hit('a')
    limiter.hit('a')
    expect(limiter.hit('b').current).toBe(1)
  })

  /**
   * ADR-011 asks for backoff rather than a lockout: an attacker must not be
   * able to lock a victim out by failing on their behalf, but must also not
   * get an unbounded retry budget.
   */
  it('doubles the window after one that was exhausted, up to the cap', () => {
    const { clock, limiter } = setUp()
    for (let attempt = 0; attempt < CONFIG.max + 1; attempt += 1) limiter.hit('a')
    expect(limiter.windowFor('a')).toBe(1_000)

    clock.advance(1_000)
    expect(limiter.hit('a')).toEqual({ current: 1, ttl: 2_000 })
    expect(limiter.windowFor('a')).toBe(2_000)

    for (let attempt = 0; attempt < CONFIG.max; attempt += 1) limiter.hit('a')
    clock.advance(2_000)
    limiter.hit('a')
    expect(limiter.windowFor('a')).toBe(4_000)

    for (let attempt = 0; attempt < CONFIG.max; attempt += 1) limiter.hit('a')
    clock.advance(4_000)
    limiter.hit('a')
    expect(limiter.windowFor('a')).toBe(8_000)

    // Capped: the key always recovers, however long it has been failing.
    for (let attempt = 0; attempt < CONFIG.max; attempt += 1) limiter.hit('a')
    clock.advance(8_000)
    limiter.hit('a')
    expect(limiter.windowFor('a')).toBe(8_000)
  })

  it('drops back to the base window after a window that was not exhausted', () => {
    const { clock, limiter } = setUp()
    for (let attempt = 0; attempt < CONFIG.max + 1; attempt += 1) limiter.hit('a')
    clock.advance(1_000)
    limiter.hit('a')
    expect(limiter.windowFor('a')).toBe(2_000)

    clock.advance(2_000)
    limiter.hit('a')
    expect(limiter.windowFor('a')).toBe(1_000)
  })

  it('forgets a key on reset, and reports the base window for an unknown one', () => {
    const { limiter } = setUp()
    limiter.hit('a')
    limiter.hit('a')
    limiter.reset('a')
    expect(limiter.hit('a').current).toBe(1)
    expect(limiter.windowFor('unknown')).toBe(CONFIG.windowMs)
  })

  describe('the @fastify/rate-limit store', () => {
    it('answers incr through the limiter, and shares one keyspace across routes', () => {
      const { limiter } = setUp()
      const store = new limiter.store()

      const seen: { current: number; ttl: number }[] = []
      store.incr('a', (error, result) => {
        expect(error).toBeNull()
        seen.push(result)
      })
      // `child` is how the plugin scopes a store per route; the bucket name
      // is already part of the key, so one keyspace is the right answer.
      store.child({}).incr('a', (_error, result) => seen.push(result))

      expect(seen.map((entry) => entry.current)).toEqual([1, 2])
    })
  })
})
