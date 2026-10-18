import { describe, expect, it } from 'vitest'

import {
  DEPRECATED_CANNOT_BE_VERIFIED,
  LIFECYCLE_STATES,
  canMoveLifecycle,
  isLifecycleState,
  lifecycleLabel,
  reviewFreshness,
} from './document-lifecycle.ts'

describe('the lifecycle vocabulary', () => {
  it('is in review, verified and deprecated, in words a reader says', () => {
    expect(LIFECYCLE_STATES.map(lifecycleLabel)).toEqual(['In review', 'Verified', 'Deprecated'])
  })

  it('recognises its own states and nothing from before it', () => {
    expect(isLifecycleState('verified')).toBe(true)
    expect(isLifecycleState('draft')).toBe(false)
    expect(isLifecycleState('published')).toBe(false)
    expect(isLifecycleState(undefined)).toBe(false)
  })
})

describe('moving between states', () => {
  it('refuses deprecated straight to verified, and says why', () => {
    expect(canMoveLifecycle('deprecated', 'verified')).toBe(false)
    expect(DEPRECATED_CANNOT_BE_VERIFIED).toMatch(/cannot be verified/u)
  })

  it('allows every other move, including clearing it', () => {
    const states = [undefined, ...LIFECYCLE_STATES]
    const allowed = states.flatMap((from) =>
      states.filter((to) => canMoveLifecycle(from, to)).map((to) => `${from}->${to}`),
    )
    expect(allowed).toHaveLength(states.length * states.length - 1)
    expect(allowed).not.toContain('deprecated->verified')
  })
})

describe('freshness', () => {
  const now = new Date('2026-10-17T00:00:00Z')

  it('is current until the fortnight before the review, due within it, overdue after', () => {
    expect(reviewFreshness(new Date('2026-11-17T00:00:00Z'), now)).toBe('current')
    expect(reviewFreshness(new Date('2026-10-31T00:00:00Z'), now)).toBe('due')
    expect(reviewFreshness(new Date('2026-10-17T00:00:00Z'), now)).toBe('due')
    expect(reviewFreshness(new Date('2026-10-16T23:59:59Z'), now)).toBe('overdue')
  })
})
