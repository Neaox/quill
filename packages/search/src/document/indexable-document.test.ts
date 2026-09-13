import { describe, expect, it } from 'vitest'

import { assertSupportedIndexableDocumentVersion, headingWeight } from './indexable-document.ts'

describe('headingWeight', () => {
  it('gives an h1 the maximum weight', () => {
    expect(headingWeight(1)).toBe(6)
  })

  it('gives an h6 the minimum weight', () => {
    expect(headingWeight(6)).toBe(1)
  })

  it('weighs a mid-level heading between the extremes', () => {
    expect(headingWeight(3)).toBe(4)
  })

  it('clamps a depth shallower than 1', () => {
    expect(headingWeight(0)).toBe(6)
  })

  it('clamps a depth deeper than 6', () => {
    expect(headingWeight(9)).toBe(1)
  })
})

describe('assertSupportedIndexableDocumentVersion', () => {
  it('accepts version 1', () => {
    expect(assertSupportedIndexableDocumentVersion({ version: 1 })).toEqual({ ok: true, value: 1 })
  })

  it('refuses a version it has never shipped', () => {
    expect(assertSupportedIndexableDocumentVersion({ version: 2 })).toEqual({
      ok: false,
      error: { kind: 'unsupported-indexable-document-version', version: 2 },
    })
  })
})
