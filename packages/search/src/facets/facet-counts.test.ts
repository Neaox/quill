import { describe, expect, it } from 'vitest'

import { FACET_NAMES, addCounts, rankFacetCounts } from './facet-counts.ts'

describe('FACET_NAMES', () => {
  it('names the facets a search can count', () => {
    expect(FACET_NAMES).toEqual(['tag', 'status', 'collection'])
  })
})

describe('addCounts', () => {
  it('adds each value to what is already counted, so batches merge', () => {
    const counts = new Map<string, number>()
    addCounts(counts, [{ value: 'a', count: 2 }])
    addCounts(counts, [
      { value: 'a', count: 3 },
      { value: 'b', count: 1 },
    ])
    expect(counts).toEqual(
      new Map([
        ['a', 5],
        ['b', 1],
      ]),
    )
  })
})

describe('rankFacetCounts', () => {
  it('puts the largest count first and breaks ties by value in code-point order', () => {
    const counts = new Map([
      ['b', 2],
      ['a', 2],
      ['c', 9],
      ['Z', 2],
    ])
    expect(rankFacetCounts(counts, 10)).toEqual([
      { value: 'c', count: 9 },
      { value: 'Z', count: 2 },
      { value: 'a', count: 2 },
      { value: 'b', count: 2 },
    ])
  })

  it('keeps at most the limit', () => {
    const counts = new Map([
      ['a', 3],
      ['b', 2],
      ['c', 1],
    ])
    expect(rankFacetCounts(counts, 2).map(({ value }) => value)).toEqual(['a', 'b'])
  })

  it('has nothing to rank when nothing was counted', () => {
    expect(rankFacetCounts(new Map(), 8)).toEqual([])
  })
})
