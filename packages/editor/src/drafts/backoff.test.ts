import { describe, expect, it } from 'vitest'

import { backoffDelay } from './backoff.ts'

const policy = { baseMs: 1000, capMs: 30_000 }
const highest = () => 1

describe('backoffDelay', () => {
  it('doubles with each attempt', () => {
    expect(
      [1, 2, 3, 4].map((attempt) => backoffDelay(attempt, { ...policy, random: highest })),
    ).toEqual([1000, 2000, 4000, 8000])
  })

  it('jitters with Math.random when no source is given', () => {
    const delay = backoffDelay(2, policy)
    expect(delay).toBeGreaterThanOrEqual(1000)
    expect(delay).toBeLessThanOrEqual(2000)
  })

  it('never waits longer than the cap', () => {
    expect(backoffDelay(20, { ...policy, random: () => 1 })).toBe(30_000)
  })

  it('jitters into the upper half, so a herd of clients spreads out but never retries at once', () => {
    expect(backoffDelay(3, { ...policy, random: () => 0 })).toBe(2000)
    expect(backoffDelay(3, { ...policy, random: () => 0.5 })).toBe(3000)
  })

  it('honours a Retry-After that asks for longer than the backoff would wait', () => {
    expect(backoffDelay(1, { ...policy, random: () => 1, retryAfterMs: 12_000 })).toBe(12_000)
    expect(backoffDelay(5, { ...policy, random: () => 1, retryAfterMs: 500 })).toBe(16_000)
  })
})
