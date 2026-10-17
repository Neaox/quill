import { describe, expect, it } from 'vitest'

import type { FactsView } from '@quill/application'
import type { PublicDocumentFacts } from '@quill/domain'

import { factsResponse, publicFactsResponse } from './document-schemas.ts'

/**
 * Facts on the wire: an unstated fact is an absent key, never `undefined` or
 * `null`, whichever audience the facts are for.
 */

const NOTHING_STATED: FactsView = {
  status: undefined,
  lifecycle: undefined,
  type: undefined,
  owners: [],
  tags: [],
  reviewInterval: undefined,
  lastReviewed: undefined,
}

const REPLACEMENT = { href: '/w/acme/d/overview-k3', title: 'Overview' }

describe('factsResponse', () => {
  it('leaves out every fact the document does not state', () => {
    expect(factsResponse(NOTHING_STATED)).toEqual({ owners: [], tags: [] })
  })

  it('carries every fact the document states, owners as label and person', () => {
    expect(
      factsResponse({
        status: 'draft',
        lifecycle: { state: 'in-review' },
        type: 'runbook',
        owners: [{ label: 'Ada', person: true }],
        tags: ['api'],
        reviewInterval: '90d',
        lastReviewed: '2026-01-02',
      }),
    ).toEqual({
      status: 'draft',
      lifecycle: { state: 'in-review' },
      type: 'runbook',
      owners: [{ label: 'Ada', person: true }],
      tags: ['api'],
      reviewInterval: '90d',
      lastReviewed: '2026-01-02',
    })
  })

  it('names who verified and when, and only what is known of it', () => {
    expect(
      factsResponse({
        ...NOTHING_STATED,
        lifecycle: {
          state: 'verified',
          verifiedBy: { label: 'Ada', person: true },
          verifiedAt: '2026-01-02',
        },
      }).lifecycle,
    ).toEqual({
      state: 'verified',
      verifiedBy: { label: 'Ada', person: true },
      verifiedAt: '2026-01-02',
    })
    expect(
      factsResponse({
        ...NOTHING_STATED,
        lifecycle: { state: 'verified', verifiedBy: undefined, verifiedAt: undefined },
      }).lifecycle,
    ).toEqual({ state: 'verified' })
  })

  it('gives a deprecated document the replacement this reader may open, and none otherwise', () => {
    const deprecated: FactsView = {
      ...NOTHING_STATED,
      lifecycle: { state: 'deprecated', supersededBy: 'overview-k3' },
    }
    expect(factsResponse(deprecated, REPLACEMENT).lifecycle).toEqual({
      state: 'deprecated',
      replacement: REPLACEMENT,
    })
    // The reference itself never goes on the wire: it may name a page the reader cannot see.
    expect(factsResponse(deprecated).lifecycle).toEqual({ state: 'deprecated' })
  })
})

describe('publicFactsResponse', () => {
  const PUBLIC_NOTHING: PublicDocumentFacts = {
    status: undefined,
    lifecycle: undefined,
    tags: [],
    lastReviewed: undefined,
  }

  it('leaves out every fact the document does not state', () => {
    expect(publicFactsResponse(PUBLIC_NOTHING)).toEqual({ tags: [] })
  })

  it('carries what an outsider may know, and never who verified', () => {
    expect(
      publicFactsResponse({
        status: 'draft',
        lifecycle: { state: 'verified', verifiedAt: '2026-01-02' },
        tags: ['api'],
        lastReviewed: '2026-01-02',
      }),
    ).toEqual({
      status: 'draft',
      lifecycle: { state: 'verified', verifiedAt: '2026-01-02' },
      tags: ['api'],
      lastReviewed: '2026-01-02',
    })
  })

  it('gives a deprecated document its replacement on this surface', () => {
    expect(
      publicFactsResponse(
        { ...PUBLIC_NOTHING, lifecycle: { state: 'deprecated', supersededBy: 'overview-k3' } },
        REPLACEMENT,
      ).lifecycle,
    ).toEqual({ state: 'deprecated', replacement: REPLACEMENT })
  })
})
