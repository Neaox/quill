import { describe, expect, it } from 'vitest'

import { entryWeight, highlight } from './highlight.ts'
import { packRanges } from './pack.ts'
import { tokenize } from './tokenize.ts'

describe('highlight', () => {
  it('returns ranges and their packed form for the given text and language', () => {
    const result = highlight('{"a":1}', 'json')
    expect(result.ranges).toEqual(tokenize('{"a":1}', 'json'))
    expect(result.packed).toBe(packRanges(result.ranges))
  })

  it('returns the identical result object on a cache hit', () => {
    const first = highlight('const x = 1', 'javascript')
    const second = highlight('const x = 1', 'javascript')
    expect(second).toBe(first)
  })

  it('does not confuse the same text under different languages', () => {
    const asJson = highlight('true', 'json')
    const asJs = highlight('true', 'javascript')
    expect(asJson).not.toBe(asJs)
  })

  it('weighs an entry by its retained ranges as well as its text', () => {
    // Two blocks of the same length cost the cache very differently: a densely
    // tokenized one retains a range object per few characters, which weighing
    // `text.length` alone ignored entirely.
    const key = 'javascript const a=1;'
    const none = entryWeight(key, [])
    const some = entryWeight(key, [
      { start: 0, end: 5, type: 'keyword' },
      { start: 6, end: 7, type: 'variable' },
    ])

    expect(none).toBe(key.length)
    expect(some).toBeGreaterThan(none)
  })

  it('returns a fresh result for different text', () => {
    const a = highlight('const a = 1', 'javascript')
    const b = highlight('const other = 99', 'javascript')
    expect(a).not.toBe(b)
    expect(a.packed).not.toBe(b.packed)
  })
})
