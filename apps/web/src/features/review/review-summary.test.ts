import { describe, expect, it } from 'vitest'

import { summariseReview, type ReviewLike } from './review-summary.ts'

const assignment = (state: 'pending' | 'approved' | 'changes_requested') => ({
  state,
  reviewer: { kind: 'user' as const, id: 'u', name: 'Ada' },
})

const review = (overrides: Partial<ReviewLike> = {}): ReviewLike => ({
  status: 'open',
  stale: false,
  assignments: [assignment('approved'), assignment('pending'), assignment('pending')],
  ...overrides,
})

describe('summariseReview', () => {
  it('counts the answers on an open request', () => {
    expect(summariseReview(review())).toEqual({
      label: 'In review · 1 of 3 approved',
      short: 'In review',
      tone: 'accent',
    })
  })

  it('says when the draft has moved on since', () => {
    expect(summariseReview(review({ stale: true }))?.label).toBe(
      'In review · 1 of 3 approved · changed since',
    )
  })

  it('says what a settled request came to', () => {
    expect(summariseReview(review({ status: 'approved' }))).toEqual({
      label: 'Approved',
      short: 'Approved',
      tone: 'success',
    })
    expect(summariseReview(review({ status: 'changes_requested' }))).toEqual({
      label: 'Changes requested',
      short: 'Changes asked',
      tone: 'warning',
    })
  })

  it('has nothing to say about a request that is over', () => {
    for (const status of ['withdrawn', 'superseded', 'published'] as const) {
      expect(summariseReview(review({ status }))).toBeUndefined()
    }
  })

  it('has nothing to say about no request', () => {
    expect(summariseReview(null)).toBeUndefined()
  })
})
