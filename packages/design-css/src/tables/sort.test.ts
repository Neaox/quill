import { describe, expect, it } from 'vitest'

import { columnKind, nextDirection, readDate, readNumber, sortRows } from './sort.ts'

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

const sorted = (texts: readonly string[], direction: 'ascending' | 'descending'): string[] =>
  sortRows(
    texts.map((text) => ({ item: text, text })),
    direction,
    collator,
  )

describe('the sort cycle', () => {
  it('goes ascending, descending, then back to the order as written', () => {
    expect(nextDirection(undefined)).toBe('ascending')
    expect(nextDirection('ascending')).toBe('descending')
    expect(nextDirection('descending')).toBeUndefined()
  })
})

describe('reading a cell', () => {
  it('reads numbers with separators, signs, currencies, percentages and units', () => {
    expect(readNumber('1,250.5')).toBe(1250.5)
    expect(readNumber('−3.5 %')).toBe(-3.5)
    expect(readNumber('$1,200')).toBe(1200)
    expect(readNumber('120 ms')).toBe(120)
    expect(readNumber('eu-west-1')).toBeUndefined()
    expect(readNumber('1.2.3')).toBeUndefined()
  })

  it('reads ISO dates and dates written out with the month named', () => {
    expect(readDate('2026-10-11')).toBe(Date.UTC(2026, 9, 11))
    expect(readDate('2026-10-11T09:30:00Z')).toBe(Date.UTC(2026, 9, 11, 9, 30))
    expect(readDate('11 October 2026')).toBe(Date.UTC(2026, 9, 11))
    expect(readDate('Oct 11, 2026')).toBe(Date.UTC(2026, 9, 11))
    expect(readDate('11 Smarch 2026')).toBeUndefined()
    expect(readDate('Smarch 11, 2026')).toBeUndefined()
    expect(readDate('next week')).toBeUndefined()
  })

  it('names a column by the narrowest kind all its cells read as', () => {
    expect(columnKind(['3', '', '—', '1,000'])).toBe('number')
    expect(columnKind(['2026-01-02', '3 March 2025'])).toBe('date')
    expect(columnKind(['3', 'three'])).toBe('text')
    expect(columnKind(['', '—'])).toBe('text')
  })
})

describe('sorting a column', () => {
  it('sorts numbers by value, not by their digits', () => {
    expect(sorted(['120', '9', '1,000', '-4'], 'ascending')).toEqual(['-4', '9', '120', '1,000'])
    expect(sorted(['120', '9', '1,000'], 'descending')).toEqual(['1,000', '120', '9'])
  })

  it('sorts dates by when they are', () => {
    expect(sorted(['3 March 2025', '2024-12-31', 'Jan 5, 2026'], 'ascending')).toEqual([
      '2024-12-31',
      '3 March 2025',
      'Jan 5, 2026',
    ])
  })

  it('sorts text in the reader’s language, with digits read as numbers', () => {
    expect(sorted(['Item 10', 'item 9', 'Éclair', 'apple'], 'ascending')).toEqual([
      'apple',
      'Éclair',
      'item 9',
      'Item 10',
    ])
  })

  it('puts empty cells last in either direction, and keeps ties in written order', () => {
    expect(sorted(['b', '', 'a', '—', 'b'], 'ascending')).toEqual(['a', 'b', 'b', '', '—'])
    const rows = ['b', '', 'a', 'b'].map((text, index) => ({ item: index, text }))
    expect(sortRows(rows, 'descending', collator)).toEqual([0, 3, 2, 1])
  })
})
