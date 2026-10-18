import { createFakeClock } from '@quill/application/test-support'
import { userId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { BucketSet, createLinkPreviewRateLimits } from './rate-limits.ts'
import type { LinkPreviewRateLimitConfig } from './rate-limits.ts'

const START = new Date('2026-10-13T09:00:00.000Z')
const slow = (capacity: number) => ({ capacity, refillPerSecond: 0.0001 })

describe('BucketSet', () => {
  function buckets(capacity = 3, refillPerSecond = 1, maxKeys = 100) {
    const clock = createFakeClock(START)
    return { clock, set: new BucketSet({ capacity, refillPerSecond, maxKeys }, clock) }
  }

  it('allows a burst up to its capacity, answering 0, then says how long to wait', () => {
    const { set } = buckets(3, 1)
    expect([1, 2, 3].map(() => set.take('a'))).toEqual([0, 0, 0])
    expect(set.take('a')).toBe(1000)
  })

  it('refills over time, a token a second here, and never beyond capacity', () => {
    const { set, clock } = buckets(3)
    for (let i = 0; i < 3; i += 1) set.take('a')
    clock.advance(1000)
    expect(set.take('a')).toBe(0)
    expect(set.take('a')).toBeGreaterThan(0)
    clock.advance(60_000)
    expect([1, 2, 3].map(() => set.take('a'))).toEqual([0, 0, 0])
    expect(set.take('a')).toBeGreaterThan(0)
  })

  it('says how long until a token, counting what has already refilled', () => {
    const { set, clock } = buckets(1, 0.5)
    set.take('a')
    expect(set.take('a')).toBe(2000)
    clock.advance(1500)
    expect(set.take('a')).toBe(500)
    clock.advance(500)
    expect(set.take('a')).toBe(0)
  })

  it('refills in fractions, so a slow rate is not rounded away', () => {
    const { set, clock } = buckets(1, 0.1)
    set.take('a')
    clock.advance(5000)
    expect(set.take('a')).toBe(5000)
    clock.advance(5000)
    expect(set.take('a')).toBe(0)
  })

  it('keeps each key to itself', () => {
    const { set } = buckets(1)
    expect(set.take('a')).toBe(0)
    expect(set.take('b')).toBe(0)
    expect(set.take('a')).toBeGreaterThan(0)
  })

  it('gives a token back, up to capacity', () => {
    const { set } = buckets(1)
    set.take('a')
    set.refund('a')
    set.refund('a')
    expect(set.take('a')).toBe(0)
    expect(set.take('a')).toBeGreaterThan(0)
  })

  it('forgets the least recently used key rather than growing without bound', () => {
    const { set } = buckets(1, 0.0001, 2)
    set.take('a')
    set.take('b')
    set.take('a')
    set.take('c')
    // `a` was used more recently than `b`, so `a` was kept (and is still empty) and `b` was forgotten.
    expect(set.take('a')).toBeGreaterThan(0)
    expect(set.take('b')).toBe(0)
  })
})

const fetchOf = (
  limits: ReturnType<typeof createLinkPreviewRateLimits>,
  host: string,
  scope: string,
) => limits.allowFetch({ host, scope })

describe('BucketSet.takeUpTo', () => {
  it('takes whole tokens only, never more than asked, never more than there are', () => {
    const clock = createFakeClock(START)
    const set = new BucketSet({ capacity: 5, refillPerSecond: 1, maxKeys: 10 }, clock)
    expect(set.takeUpTo('a', 3)).toBe(3)
    expect(set.takeUpTo('a', 10)).toBe(2)
    expect(set.takeUpTo('a', 1)).toBe(0)
    clock.advance(1500)
    expect(set.takeUpTo('a', 5)).toBe(1)
  })

  it('takes nothing when nothing is asked for', () => {
    const set = new BucketSet(
      { capacity: 5, refillPerSecond: 1, maxKeys: 10 },
      createFakeClock(START),
    )
    expect(set.takeUpTo('a', 0)).toBe(0)
    // Asking for none leaves the whole allowance there.
    expect(set.takeUpTo('a', 5)).toBe(5)
  })
})

describe('createLinkPreviewRateLimits', () => {
  const generous = { capacity: 1000, refillPerSecond: 1000 }
  const config = (overrides: Partial<LinkPreviewRateLimitConfig>): LinkPreviewRateLimitConfig => ({
    perHost: generous,
    perScope: generous,
    global: generous,
    refreshPerPerson: generous,
    readsPerPerson: generous,
    queuedPerPerson: generous,
    ...overrides,
  })
  it('limits one host, and says when it can be asked again', () => {
    const clock = createFakeClock(START)
    const limits = createLinkPreviewRateLimits(
      clock,
      config({ perHost: { capacity: 2, refillPerSecond: 0.5 } }),
    )
    expect(fetchOf(limits, 'a.example', 'public')).toEqual({ allowed: true })
    expect(fetchOf(limits, 'a.example', 'public')).toEqual({ allowed: true })
    expect(fetchOf(limits, 'a.example', 'public')).toEqual({ allowed: false, retryAfterMs: 2000 })
    expect(fetchOf(limits, 'b.example', 'public')).toEqual({ allowed: true })
    clock.advance(2000)
    expect(fetchOf(limits, 'a.example', 'public')).toEqual({ allowed: true })
  })

  it('limits one scope across every host', () => {
    const limits = createLinkPreviewRateLimits(
      createFakeClock(START),
      config({ perScope: slow(2) }),
    )
    expect(fetchOf(limits, 'a.example', 'org:a').allowed).toBe(true)
    expect(fetchOf(limits, 'b.example', 'org:a').allowed).toBe(true)
    expect(fetchOf(limits, 'c.example', 'org:a').allowed).toBe(false)
    expect(fetchOf(limits, 'c.example', 'org:b').allowed).toBe(true)
  })

  it('limits the instance as a whole', () => {
    const limits = createLinkPreviewRateLimits(createFakeClock(START), config({ global: slow(2) }))
    expect(fetchOf(limits, 'a.example', 'org:a').allowed).toBe(true)
    expect(fetchOf(limits, 'b.example', 'org:b').allowed).toBe(true)
    expect(fetchOf(limits, 'c.example', 'org:c').allowed).toBe(false)
  })

  it('waits for the slowest ceiling when several are exhausted', () => {
    const limits = createLinkPreviewRateLimits(
      createFakeClock(START),
      config({
        perHost: { capacity: 1, refillPerSecond: 1 },
        perScope: { capacity: 1, refillPerSecond: 0.1 },
      }),
    )
    fetchOf(limits, 'a.example', 'org:a')
    expect(fetchOf(limits, 'a.example', 'org:a')).toEqual({ allowed: false, retryAfterMs: 10_000 })
  })

  it('does not spend an allowance on a fetch another ceiling refused', () => {
    const limits = createLinkPreviewRateLimits(
      createFakeClock(START),
      config({ perHost: slow(1), perScope: slow(1), global: slow(1) }),
    )
    expect(fetchOf(limits, 'a.example', 'org:a').allowed).toBe(true)
    // Refused by every ceiling; nothing for `b.example` or `org:b` was charged.
    expect(fetchOf(limits, 'b.example', 'org:b').allowed).toBe(false)
    const roomy = createLinkPreviewRateLimits(
      createFakeClock(START),
      config({ perHost: slow(1), perScope: slow(1) }),
    )
    roomy.allowFetch({ host: 'a.example', scope: 'org:a' })
    expect(roomy.allowFetch({ host: 'b.example', scope: 'org:a' }).allowed).toBe(false)
    expect(roomy.allowFetch({ host: 'b.example', scope: 'org:b' }).allowed).toBe(true)
  })

  it('limits forced refreshes per person', () => {
    const limits = createLinkPreviewRateLimits(
      createFakeClock(START),
      config({ refreshPerPerson: slow(2) }),
    )
    const ada = userId('00000000-0000-4000-8000-00000000000a')
    const bob = userId('00000000-0000-4000-8000-00000000000b')
    expect([1, 2, 3].map(() => limits.allowRefresh(ada))).toEqual([true, true, false])
    expect(limits.allowRefresh(bob)).toBe(true)
  })

  it('limits how often one person may ask about a page of links', () => {
    const limits = createLinkPreviewRateLimits(
      createFakeClock(START),
      config({ readsPerPerson: slow(2) }),
    )
    const ada = userId('00000000-0000-4000-8000-00000000000a')
    const bob = userId('00000000-0000-4000-8000-00000000000b')
    expect([1, 2, 3].map(() => limits.allowRead(ada))).toEqual([true, true, false])
    expect(limits.allowRead(bob)).toBe(true)
  })

  it('gives a person as many new fetches as their allowance holds, and no more', () => {
    const limits = createLinkPreviewRateLimits(
      createFakeClock(START),
      config({ queuedPerPerson: slow(10) }),
    )
    const ada = userId('00000000-0000-4000-8000-00000000000a')
    const bob = userId('00000000-0000-4000-8000-00000000000b')
    expect(limits.allowQueued(ada, 4)).toBe(4)
    expect(limits.allowQueued(ada, 4)).toBe(4)
    expect(limits.allowQueued(ada, 4)).toBe(2)
    expect(limits.allowQueued(ada, 4)).toBe(0)
    expect(limits.allowQueued(bob, 3)).toBe(3)
  })

  it('refills the allowance for new fetches over time', () => {
    const clock = createFakeClock(START)
    const limits = createLinkPreviewRateLimits(
      clock,
      config({ queuedPerPerson: { capacity: 10, refillPerSecond: 2 } }),
    )
    const ada = userId('00000000-0000-4000-8000-00000000000a')
    expect(limits.allowQueued(ada, 10)).toBe(10)
    expect(limits.allowQueued(ada, 10)).toBe(0)
    clock.advance(3000)
    expect(limits.allowQueued(ada, 10)).toBe(6)
  })

  it('uses sensible defaults: a burst of five to one host, then one every two seconds', () => {
    const limits = createLinkPreviewRateLimits(createFakeClock(START))
    const results = Array.from({ length: 10 }, () => fetchOf(limits, 'a.example', 'public'))
    expect(results.filter((result) => result.allowed)).toHaveLength(5)
    expect(results.at(-1)).toEqual({ allowed: false, retryAfterMs: 2000 })
  })
})
