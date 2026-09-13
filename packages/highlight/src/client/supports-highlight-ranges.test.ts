import { describe, expect, it } from 'vitest'

import { supportsHighlightRanges } from './supports-highlight-ranges.ts'

function FakeHighlight(): void {}

describe('supportsHighlightRanges', () => {
  it('is true when CSS.highlights and Highlight both exist', () => {
    expect(
      supportsHighlightRanges({ CSS: { highlights: new Map() }, Highlight: FakeHighlight }),
    ).toBe(true)
  })

  it('is false with no CSS at all', () => {
    expect(supportsHighlightRanges({})).toBe(false)
  })

  it('is false when CSS exists but has no highlights registry', () => {
    expect(supportsHighlightRanges({ CSS: {}, Highlight: FakeHighlight })).toBe(false)
  })

  it('is false when Highlight is missing', () => {
    expect(supportsHighlightRanges({ CSS: { highlights: new Map() } })).toBe(false)
  })
})
