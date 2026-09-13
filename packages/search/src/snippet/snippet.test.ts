import { describe, expect, it } from 'vitest'

import { buildSnippet } from './snippet.ts'

describe('buildSnippet', () => {
  it('returns an empty snippet for an empty body', () => {
    expect(buildSnippet('', ['anything'])).toEqual({ text: '', ranges: [] })
  })

  it('falls back to the start of the body when nothing matches', () => {
    const result = buildSnippet('First sentence. Second sentence.', ['absent'])
    expect(result.ranges).toEqual([])
    expect(result.text.startsWith('First sentence.')).toBe(true)
  })

  it('ignores an empty-string term rather than matching everywhere', () => {
    const result = buildSnippet('First sentence. Second sentence.', [''])
    expect(result.ranges).toEqual([])
    expect(result.text.startsWith('First sentence.')).toBe(true)
  })

  it('falls back to the start of the body when given no terms', () => {
    const result = buildSnippet('First sentence. Second sentence.', [])
    expect(result.ranges).toEqual([])
    expect(result.text.startsWith('First sentence.')).toBe(true)
  })

  it('highlights a single match at its offset within the sentence', () => {
    const body = 'The quick fox jumps.'
    const result = buildSnippet(body, ['quick'])
    expect(result.text).toBe(body)
    expect(result.ranges).toEqual([{ start: 4, end: 9 }])
    expect(result.text.slice(result.ranges[0]?.start, result.ranges[0]?.end)).toBe('quick')
  })

  it('matches case-insensitively', () => {
    const result = buildSnippet('The Quick fox jumps.', ['quick'])
    expect(result.ranges).toEqual([{ start: 4, end: 9 }])
  })

  it('highlights every occurrence of a repeated term', () => {
    const body = 'cat sat on the cat mat.'
    const result = buildSnippet(body, ['cat'])
    expect(result.ranges).toEqual([
      { start: 0, end: 3 },
      { start: 15, end: 18 },
    ])
  })

  it('highlights matches from more than one term, in document order', () => {
    const body = 'alpha beta gamma'
    const result = buildSnippet(body, ['gamma', 'alpha'])
    expect(result.ranges).toEqual([
      { start: 0, end: 5 },
      { start: 11, end: 16 },
    ])
  })

  it('grows the window forward to a following sentence while it still fits', () => {
    const body = 'Match here. Second sentence follows.'
    const result = buildSnippet(body, ['match'], { maxLength: 100 })
    expect(result.text).toBe(body)
    expect(result.ranges).toEqual([{ start: 0, end: 5 }])
  })

  it('stops growing the window once the next sentence would not fit', () => {
    const body = 'Match here. This next sentence is far too long to fit in a tiny window.'
    const result = buildSnippet(body, ['match'], { maxLength: 20 })
    expect(result.text).toBe('Match here.')
    expect(result.ranges).toEqual([{ start: 0, end: 5 }])
  })

  it('starts the window at the sentence holding the first match, not the body start', () => {
    const body = 'Nothing to see. The match is here.'
    const result = buildSnippet(body, ['match'], { maxLength: 100 })
    expect(result.text).toBe('The match is here.')
    expect(result.ranges).toEqual([{ start: 4, end: 9 }])
  })

  it('truncates a single sentence longer than the limit around the match', () => {
    const body = `${'padding '.repeat(10)}MATCH${' more padding'.repeat(10)}.`
    const result = buildSnippet(body, ['match'], { maxLength: 40 })
    expect(result.text.length).toBeLessThanOrEqual(40)
    expect(result.ranges).toHaveLength(1)
    expect(result.ranges[0]).toBeDefined()
    const range = result.ranges[0]!
    expect(result.text.slice(range.start, range.end).toLowerCase()).toBe('match')
  })

  it('keeps offsets correct across multi-code-unit Unicode text', () => {
    const body = 'café 🎉 party is great.'
    const result = buildSnippet(body, ['party'])
    expect(result.ranges[0]).toBeDefined()
    const range = result.ranges[0]!
    expect(result.text.slice(range.start, range.end)).toBe('party')
  })

  it('drops a match that falls outside the chosen window', () => {
    const body = 'Find cat here. Another sentence mentions cat again but is far away and long.'
    const result = buildSnippet(body, ['cat'], { maxLength: 15 })
    expect(result.ranges).toHaveLength(1)
    expect(result.text).not.toContain('again')
  })

  it('adjusts ranges when leading whitespace is trimmed from a truncated window', () => {
    // One long sentence, so the window is a truncated slice through it rather
    // than a sentence boundary: the slice starts mid-whitespace, and trimming
    // that whitespace must shift the match's range by exactly as much.
    const body = 'aaaaa     match     bbbbb.'
    const result = buildSnippet(body, ['match'], { maxLength: 10 })
    expect(result.text.startsWith(' ')).toBe(false)
    expect(result.text).toBe('match')
    expect(result.ranges).toEqual([{ start: 0, end: 5 }])
  })
})
