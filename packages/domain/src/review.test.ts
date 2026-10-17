import { describe, expect, it } from 'vitest'

import { deriveReviewStatus, isActiveReviewStatus } from './review.ts'

describe('deriveReviewStatus', () => {
  it('is open while anyone is still pending and nobody has asked for changes', () => {
    expect(deriveReviewStatus(['pending', 'approved'])).toBe('open')
    expect(deriveReviewStatus(['pending'])).toBe('open')
  })

  it('is changes_requested as soon as one reviewer asks, even with others pending', () => {
    expect(deriveReviewStatus(['changes_requested', 'pending'])).toBe('changes_requested')
    expect(deriveReviewStatus(['approved', 'changes_requested'])).toBe('changes_requested')
  })

  it('is approved only when every assignment is approved', () => {
    expect(deriveReviewStatus(['approved', 'approved'])).toBe('approved')
  })

  it('is open when there is nobody to ask', () => {
    expect(deriveReviewStatus([])).toBe('open')
  })
})

describe('isActiveReviewStatus', () => {
  it.each([
    ['open', true],
    ['approved', true],
    ['changes_requested', true],
    ['withdrawn', false],
    ['superseded', false],
    ['published', false],
  ] as const)('%s -> %s', (status, active) => {
    expect(isActiveReviewStatus(status)).toBe(active)
  })
})
