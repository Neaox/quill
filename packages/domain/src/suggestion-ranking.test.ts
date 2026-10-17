import { describe, expect, it } from 'vitest'

import { rankSuggestions, suggestion } from './suggestion-ranking.ts'

const names = ['Sam Taylor', 'ada lovelace', 'Grace Hopper', 'Adam Smith', 'Madame Curie']

describe('rankSuggestions', () => {
  it('puts prefix matches of the label before other substring matches, alphabetical within each', () => {
    const ranked = rankSuggestions(names.map(suggestion), 'ad', 10)
    expect(ranked.map((found) => found.value)).toEqual([
      'ada lovelace',
      'Adam Smith',
      'Madame Curie',
    ])
  })

  it('ignores case and the space around what was typed', () => {
    expect(rankSuggestions(names.map(suggestion), '  GRACE ', 10)).toEqual([
      { value: 'Grace Hopper', label: 'Grace Hopper' },
    ])
  })

  it('offers everything, alphabetically, for an empty prefix', () => {
    expect(rankSuggestions(names.map(suggestion), '', 3).map((found) => found.value)).toEqual([
      'ada lovelace',
      'Adam Smith',
      'Grace Hopper',
    ])
  })

  it('keeps the first of values that differ only in case', () => {
    const ranked = rankSuggestions([suggestion('Ada'), suggestion('ADA'), suggestion('ada')], '', 5)
    expect(ranked).toEqual([{ value: 'Ada', label: 'Ada' }])
  })

  it('matches on the label and returns the value', () => {
    const ranked = rankSuggestions([{ value: 'platform', label: 'Platform (unit)' }], 'unit', 5)
    expect(ranked).toEqual([{ value: 'platform', label: 'Platform (unit)' }])
  })

  it('breaks a tie between equal labels by value', () => {
    const ranked = rankSuggestions(
      [
        { value: 'b', label: 'Same' },
        { value: 'a', label: 'Same' },
      ],
      '',
      5,
    )
    expect(ranked.map((found) => found.value)).toEqual(['a', 'b'])
  })

  it('finds nothing for a prefix nothing contains', () => {
    expect(rankSuggestions(names.map(suggestion), 'zzz', 5)).toEqual([])
  })

  it('treats %, _ and backslashes as ordinary characters', () => {
    const ranked = rankSuggestions(['100%', 'a_b', 'ab'].map(suggestion), '_', 5)
    expect(ranked.map((found) => found.value)).toEqual(['a_b'])
  })
})
