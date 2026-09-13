import {
  array,
  assert,
  constant,
  constantFrom,
  integer,
  nat,
  property,
  string,
  tuple,
  type Arbitrary,
} from 'fast-check'
import { describe, expect, it } from 'vitest'

import { toMarkup } from './markup.ts'
import { TOKEN_CLASSES, type TokenRange } from './tokens.ts'

function stripTags(html: string): string {
  return html.replaceAll(/<\/?span[^>]*>/g, '')
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** A random, non-overlapping list of token ranges that fits within `text`. */
function rangesArbitrary(text: string): Arbitrary<TokenRange[]> {
  return array(
    tuple(nat({ max: 5 }), integer({ min: 1, max: 5 }), constantFrom(...TOKEN_CLASSES)),
    {
      maxLength: 10,
    },
  ).map((triples) => {
    let cursor = 0
    const ranges: TokenRange[] = []
    for (const [gap, length, type] of triples) {
      const start = cursor + gap
      const end = start + length
      if (end > text.length) break
      ranges.push({ start, end, type })
      cursor = end
    }
    return ranges
  })
}

const caseArbitrary = string({ minLength: 0, maxLength: 60 }).chain((text) =>
  tuple(constant(text), rangesArbitrary(text)),
)

describe('toMarkup', () => {
  it('renders plain text with no ranges', () => {
    expect(toMarkup('a & b', [])).toBe('a &amp; b')
  })

  it('wraps a range in a themed span', () => {
    const ranges: TokenRange[] = [{ start: 3, end: 6, type: 'keyword' }]
    expect(toMarkup('do let x', ranges)).toBe('do <span class="tok-keyword">let</span> x')
  })

  it('handles a range touching the start and one touching the end', () => {
    const ranges: TokenRange[] = [
      { start: 0, end: 2, type: 'keyword' },
      { start: 3, end: 6, type: 'string' },
    ]
    expect(toMarkup('if "x"', ranges)).toBe(
      '<span class="tok-keyword">if</span> <span class="tok-string">"x"</span>',
    )
  })

  it('escapes HTML-significant characters inside and outside spans', () => {
    const ranges: TokenRange[] = [{ start: 0, end: 7, type: 'string' }]
    expect(toMarkup('<a>&</a>', ranges)).toBe(
      '<span class="tok-string">&lt;a&gt;&amp;&lt;/a</span>&gt;',
    )
  })

  it('sorts out-of-order ranges before rendering', () => {
    const ranges: TokenRange[] = [
      { start: 3, end: 6, type: 'string' },
      { start: 0, end: 2, type: 'keyword' },
    ]
    expect(toMarkup('if "x"', ranges)).toBe(
      '<span class="tok-keyword">if</span> <span class="tok-string">"x"</span>',
    )
  })

  it('clamps a range that runs past the end of the text', () => {
    expect(toMarkup('abc', [{ start: 1, end: 99, type: 'string' }])).toBe(
      'a<span class="tok-string">bc</span>',
    )
    expect(toMarkup('abc', [{ start: 9, end: 12, type: 'string' }])).toBe('abc')
  })

  it('clamps a range that starts before the previous one ended', () => {
    const ranges: TokenRange[] = [
      { start: 0, end: 4, type: 'keyword' },
      { start: 2, end: 6, type: 'string' },
    ]
    expect(toMarkup('abcdefg', ranges)).toBe(
      '<span class="tok-keyword">abcd</span><span class="tok-string">ef</span>g',
    )
  })

  it('drops a negative or empty range instead of emitting a stray span', () => {
    expect(toMarkup('abc', [{ start: -5, end: -1, type: 'string' }])).toBe('abc')
    expect(toMarkup('abc', [{ start: 1, end: 1, type: 'string' }])).toBe('abc')
    expect(toMarkup('abc', [{ start: 2, end: 1, type: 'string' }])).toBe('abc')
  })

  it('property: stripping tags yields the escaped text', () => {
    assert(
      property(caseArbitrary, ([text, ranges]) => {
        const html = toMarkup(text, ranges)
        expect(stripTags(html)).toBe(escapeHtml(text))
      }),
    )
  })

  it('property: holds even for ranges that overlap, reverse or overrun', () => {
    assert(
      property(
        string({ minLength: 0, maxLength: 40 }),
        array(
          tuple(
            integer({ min: -20, max: 60 }),
            integer({ min: -20, max: 60 }),
            constantFrom(...TOKEN_CLASSES),
          ),
          { maxLength: 10 },
        ),
        (text, triples) => {
          const ranges = triples.map(([start, end, type]) => ({ start, end, type }))
          expect(stripTags(toMarkup(text, ranges))).toBe(escapeHtml(text))
        },
      ),
    )
  })
})
