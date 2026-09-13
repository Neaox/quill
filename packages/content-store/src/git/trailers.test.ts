import { describe, expect, it } from 'vitest'

import { foldTrailerValue, formatTrailer, parseTrailers, trailerValues } from './trailers.ts'

describe('foldTrailerValue', () => {
  it('collapses newlines to single spaces', () => {
    expect(foldTrailerValue('First line.\nSecond line.\n\nFourth line.')).toBe(
      'First line. Second line. Fourth line.',
    )
  })

  it('collapses Windows newlines too', () => {
    expect(foldTrailerValue('a\r\nb')).toBe('a b')
  })

  it('leaves a single-line value alone', () => {
    expect(foldTrailerValue('Tidied the introduction')).toBe('Tidied the introduction')
  })
})

describe('parseTrailers', () => {
  it('reads the trailer block at the end of a message', () => {
    const message = 'Update Onboarding\n\nSome body text.\n\nA-Key: one\nB-Key: two\n'
    expect(parseTrailers(message)).toEqual([
      { key: 'A-Key', value: 'one' },
      { key: 'B-Key', value: 'two' },
    ])
  })

  it('reads repeated keys in the order they were written', () => {
    const message = 'Subject\n\nId: a\nId: b\n'
    expect(trailerValues(parseTrailers(message), 'Id')).toEqual(['a', 'b'])
  })

  it('stops at the blank line above the block', () => {
    expect(parseTrailers('Subject\n\nNot a trailer\n')).toEqual([])
  })

  it('ignores a line whose key is not a trailer key', () => {
    expect(parseTrailers('Subject\n\nsee also: nowhere\n')).toEqual([])
  })

  it('returns nothing for a message with no trailers at all', () => {
    expect(parseTrailers('Subject')).toEqual([])
  })

  it('does not mistake a bare URL for a trailer', () => {
    expect(parseTrailers('Subject\n\nhttps://example.com\n')).toEqual([])
  })

  it('reads a trailer written with no value', () => {
    expect(parseTrailers('Subject\n\nNote:\n')).toEqual([{ key: 'Note', value: '' }])
  })
})

describe('formatTrailer', () => {
  it('writes a folded, single-line value', () => {
    expect(formatTrailer('Change-Note', 'one\ntwo')).toBe('Change-Note: one two')
  })

  it('writes a value-less trailer bare, with no trailing space', () => {
    expect(formatTrailer('Change-Note', '  ')).toBe('Change-Note:')
  })

  it('round-trips through the parser', () => {
    const message = `Subject\n\n${formatTrailer('Note', 'a\nb')}\n`
    expect(trailerValues(parseTrailers(message), 'Note')).toEqual(['a b'])
  })
})
