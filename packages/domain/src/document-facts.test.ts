import { describe, expect, it } from 'vitest'

import {
  calendarDate,
  describeInterval,
  documentFacts,
  isReviewInterval,
  nextReviewDue,
  publicDocumentFacts,
  reviewDueAt,
  statusLabel,
  tagQuery,
  verificationLapsed,
} from './document-facts.ts'

const NOW = new Date('2026-10-17T09:00:00Z')

describe('the facts a document states about itself', () => {
  it('reads every field it knows from a well-formed record', () => {
    expect(
      documentFacts({
        id: '9b1f1c1e-0000-4000-8000-000000000000',
        status: 'draft',
        type: 'Runbook',
        owners: ['ada@example.com', 'platform'],
        tags: ['ops', 'database'],
        review: { interval: '6m', lastReviewed: '2026-03-01' },
      }),
    ).toEqual({
      status: 'draft',
      lifecycle: undefined,
      type: 'Runbook',
      owners: ['ada@example.com', 'platform'],
      tags: ['ops', 'database'],
      reviewInterval: '6m',
      lastReviewed: '2026-03-01',
    })
  })

  it('says nothing about a record with nothing in it', () => {
    expect(documentFacts({})).toEqual({
      status: undefined,
      lifecycle: undefined,
      type: undefined,
      owners: [],
      tags: [],
      reviewInterval: undefined,
      lastReviewed: undefined,
    })
  })

  it('leaves out what is not what its field means, rather than showing it', () => {
    const facts = documentFacts({
      status: 'retired',
      type: '   ',
      owners: [' ', 42, 'ada@example.com', 'ada@example.com'],
      tags: 'ops',
      review: { interval: '3 months', lastReviewed: '2026-02-30' },
    })
    expect(facts.status).toBeUndefined()
    expect(facts.lifecycle).toBeUndefined()
    expect(facts.type).toBeUndefined()
    expect(facts.owners).toEqual(['ada@example.com'])
    expect(facts.tags).toEqual(['ops'])
    expect(facts.reviewInterval).toBeUndefined()
    expect(facts.lastReviewed).toBeUndefined()
  })

  it('ignores a review that is not a mapping', () => {
    expect(documentFacts({ review: '6m' }).reviewInterval).toBeUndefined()
  })
})

describe('the lifecycle a document states', () => {
  it('reads each state with what it carries', () => {
    expect(documentFacts({ status: 'in-review' }).lifecycle).toEqual({ state: 'in-review' })
    expect(
      documentFacts({
        status: 'verified',
        verified: { by: 'ada@example.com', at: '2026-10-02' },
      }).lifecycle,
    ).toEqual({ state: 'verified', verifiedBy: 'ada@example.com', verifiedAt: '2026-10-02' })
    expect(
      documentFacts({ status: 'deprecated', supersededBy: '0b9c4f1e-0000-4000-8000-000000000000' })
        .lifecycle,
    ).toEqual({ state: 'deprecated', supersededBy: '0b9c4f1e-0000-4000-8000-000000000000' })
  })

  it('reads a verification or a replacement it cannot make sense of as unstated', () => {
    expect(documentFacts({ status: 'verified', verified: 'yes' }).lifecycle).toEqual({
      state: 'verified',
      verifiedBy: undefined,
      verifiedAt: undefined,
    })
    expect(documentFacts({ status: 'deprecated', supersededBy: 7 }).lifecycle).toEqual({
      state: 'deprecated',
      supersededBy: undefined,
    })
  })

  it('never reads a status from before the lifecycle as one', () => {
    for (const status of ['draft', 'published', 'archived']) {
      expect(documentFacts({ status }).lifecycle).toBeUndefined()
    }
    // Still read as the legacy value, which the wire keeps (ADR-033).
    expect(documentFacts({ status: 'archived' }).status).toBe('archived')
  })

  it('ignores what one state carries when another is stated', () => {
    expect(
      documentFacts({ status: 'in-review', verified: { by: 'ada@example.com', at: '2026-10-02' } })
        .lifecycle,
    ).toEqual({ state: 'in-review' })
  })
})

describe('when a verification lapses', () => {
  const verified = {
    state: 'verified',
    verifiedBy: 'ada@example.com',
    verifiedAt: '2026-01-02',
  } as const

  it('lapses once the review it promised is overdue, and not before', () => {
    expect(verificationLapsed(verified, new Date('2026-10-16T00:00:00Z'), NOW)).toBe(true)
    expect(verificationLapsed(verified, new Date('2026-10-18T00:00:00Z'), NOW)).toBe(false)
  })

  it('never lapses without a review cycle, and only a verification can', () => {
    expect(verificationLapsed(verified, undefined, NOW)).toBe(false)
    expect(verificationLapsed({ state: 'in-review' }, new Date(0), NOW)).toBe(false)
    expect(verificationLapsed(undefined, new Date(0), NOW)).toBe(false)
  })

  it('counts the review from the last review, or else from the verification', () => {
    const reviewed = documentFacts({
      status: 'verified',
      verified: { at: '2026-01-02' },
      review: { interval: '1m', lastReviewed: '2026-10-01' },
    })
    expect(reviewDueAt(reviewed)?.toISOString()).toBe('2026-10-31T00:00:00.000Z')
    const unreviewed = documentFacts({
      status: 'verified',
      verified: { at: '2026-10-01' },
      review: { interval: '1m' },
    })
    expect(reviewDueAt(unreviewed)?.toISOString()).toBe('2026-10-31T00:00:00.000Z')
    expect(reviewDueAt(documentFacts({ review: { interval: '1m' } }))).toBeUndefined()
    expect(reviewDueAt(documentFacts({ review: { lastReviewed: '2026-10-01' } }))).toBeUndefined()
  })
})

describe('what an outsider is shown', () => {
  it('keeps status, tags and the last review, and never owners or cadence', () => {
    const facts = documentFacts({
      status: 'archived',
      owners: ['ada@example.com'],
      tags: ['ops'],
      review: { interval: '1y', lastReviewed: '2026-01-02' },
    })
    expect(publicDocumentFacts(facts, NOW)).toEqual({
      status: 'archived',
      lifecycle: undefined,
      tags: ['ops'],
      lastReviewed: '2026-01-02',
    })
  })

  it('does not say "published" on a page that can only be published', () => {
    expect(publicDocumentFacts(documentFacts({ status: 'published' }), NOW).status).toBeUndefined()
  })

  it('tells when a page was verified but never who verified it', () => {
    const facts = documentFacts({
      status: 'verified',
      verified: { by: 'ada@example.com', at: '2026-10-02' },
      review: { interval: '6m', lastReviewed: '2026-10-02' },
    })
    expect(publicDocumentFacts(facts, NOW).lifecycle).toEqual({
      state: 'verified',
      verifiedAt: '2026-10-02',
    })
  })

  it('claims no verification once it has lapsed', () => {
    const facts = documentFacts({
      status: 'verified',
      verified: { by: 'ada@example.com', at: '2026-01-02' },
      review: { interval: '3m', lastReviewed: '2026-01-02' },
    })
    expect(publicDocumentFacts(facts, NOW).lifecycle).toBeUndefined()
  })

  it('passes in review and deprecated through, the replacement still a reference', () => {
    expect(publicDocumentFacts(documentFacts({ status: 'in-review' }), NOW).lifecycle).toEqual({
      state: 'in-review',
    })
    expect(
      publicDocumentFacts(documentFacts({ status: 'deprecated', supersededBy: 'abc' }), NOW)
        .lifecycle,
    ).toEqual({ state: 'deprecated', supersededBy: 'abc' })
  })
})

describe('dates and intervals', () => {
  it('reads a date whether the YAML parser left it a string or made it a Date', () => {
    expect(calendarDate('2026-03-01')).toBe('2026-03-01')
    expect(calendarDate(new Date(Date.UTC(2026, 2, 1)))).toBe('2026-03-01')
    expect(calendarDate(new Date(Number.NaN))).toBeUndefined()
    expect(calendarDate('1 March')).toBeUndefined()
    expect(calendarDate(20260301)).toBeUndefined()
  })

  it('recognises a count and a unit', () => {
    expect(isReviewInterval('90d')).toBe(true)
    expect(isReviewInterval('0d')).toBe(false)
    expect(isReviewInterval('6 months')).toBe(false)
    expect(isReviewInterval(6)).toBe(false)
  })

  it('counts the next review from a date', () => {
    const from = new Date(Date.UTC(2026, 0, 1))
    expect(nextReviewDue('2w', from)?.toISOString()).toBe('2026-01-15T00:00:00.000Z')
    expect(nextReviewDue('1y', from)?.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(nextReviewDue('soon', from)).toBeUndefined()
  })

  it('says an interval in words', () => {
    expect(describeInterval('1m')).toBe('1 month')
    expect(describeInterval('6m')).toBe('6 months')
    expect(describeInterval('90d')).toBe('90 days')
    expect(describeInterval('2w')).toBe('2 weeks')
    expect(describeInterval('1y')).toBe('1 year')
    expect(describeInterval('soon')).toBe('soon')
  })
})

describe('the search for a tag', () => {
  it('is a tag filter, quoted when the tag has a space or a quote in it', () => {
    expect(tagQuery('ops')).toBe('tag:ops')
    expect(tagQuery('On call')).toBe('tag:"On call"')
    expect(tagQuery('say "hi" \\')).toBe('tag:"say \\"hi\\" \\\\"')
  })
})

describe('a status in words', () => {
  it('is the word a reader would say', () => {
    expect(statusLabel('draft')).toBe('Draft')
    expect(statusLabel('archived')).toBe('Archived')
  })
})
