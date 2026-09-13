import { assert, constantFrom, oneof, property, string } from 'fast-check'
import { describe, expect, it } from 'vitest'

import { SUPPORTED_LANGUAGES } from './grammars.ts'
import { tokenize } from './tokenize.ts'

describe('tokenize', () => {
  it('returns no ranges for an unregistered language', () => {
    expect(tokenize('const x = 1', 'cobol')).toEqual([])
  })

  it('returns no ranges for empty text', () => {
    expect(tokenize('', 'javascript')).toEqual([])
  })

  it('labels a leaf with its own resolved class, not an ancestor class', () => {
    const ranges = tokenize('const x = `${y}`', 'javascript')
    const interpolated = ranges.find(
      (range) => range.type === 'interpolation' || range.type === 'variable',
    )
    expect(interpolated).toBeDefined()
  })

  it('tiles simple JSON into the expected classes', () => {
    const ranges = tokenize('{"a":1,"b":true}', 'json')
    expect(ranges.map((range) => range.type)).toContain('property')
    expect(ranges.map((range) => range.type)).toContain('number')
    expect(ranges.map((range) => range.type)).toContain('boolean')
    expect(ranges.map((range) => range.type)).toContain('punctuation')
  })

  it('resolves a token carrying several aliases', () => {
    // Python decorators alias to ['annotation', 'punctuation']; neither is a
    // themed class on its own, but this exercises the multi-alias branch.
    const ranges = tokenize('@staticmethod\ndef f():\n    pass\n', 'python')
    expect(ranges.length).toBeGreaterThan(0)
  })

  it('drops leaves whose classes resolve to no themed class', () => {
    // `<p>hi</p>`'s text has no token of its own and no themed ancestor, so it
    // stays an untokenized gap rather than borrowing a colour.
    const ranges = tokenize('<p>hi</p>', 'markup')
    const covered = ranges.some((range) => range.start <= 3 && range.end >= 5)
    expect(covered).toBe(false)
  })

  it('gives a leaf the nearest themed ancestor when it has no class of its own', () => {
    // The diff grammar labels the whole deleted block `deleted-sign`/`deleted`
    // and its body `line`, which is themed nowhere: without the fallback only
    // the leading `-` would be coloured.
    const source = [
      '--- a/file',
      '+++ b/file',
      '@@ -1 +1 @@',
      '-gone away',
      '+arrived',
      ' context',
      '',
    ].join('\n')
    const ranges = tokenize(source, 'diff')
    const at = (needle: string): number => source.indexOf(needle)

    const line = { start: at('-gone away'), end: at('+arrived') }
    const covering = ranges.filter((range) => range.start >= line.start && range.end <= line.end)
    expect(covering.map((range) => range.type)).toEqual(['deleted', 'deleted'])
    expect(covering.at(0)?.start).toBe(line.start)
    expect(covering.at(-1)?.end).toBe(line.end)

    // A diff's file and hunk headers read as metadata about the patch.
    expect(ranges.find((range) => range.start === at('@@ -1'))?.type).toBe('comment')
    // Context lines are ordinary text and stay uncoloured.
    expect(ranges.some((range) => range.start === at(' context'))).toBe(false)
  })

  describe('property: ranges tile the text', () => {
    const languageArbitrary = constantFrom(...SUPPORTED_LANGUAGES)
    const textArbitrary = oneof(
      string({ maxLength: 200 }),
      constantFrom(
        'const x: number = 1 + 2 // comment\nfunction f(a, b) { return a + b }',
        '{"a": [1, 2, 3], "b": null, "c": "text", "d": true}',
        '<div class="a"><span>hi</span></div>',
        'SELECT * FROM users WHERE id = 1; -- note',
        '# Title\n\nSome *text* and `code`.',
        'def f(x):\n    return x + 1\n',
      ),
    )

    it('never overlaps, never exceeds the text, and gaps plus ranges reproduce the length', () => {
      assert(
        property(textArbitrary, languageArbitrary, (text, language) => {
          const ranges = tokenize(text, language)
          let cursor = 0
          for (const range of ranges) {
            expect(range.start).toBeGreaterThanOrEqual(cursor)
            expect(range.end).toBeGreaterThan(range.start)
            expect(range.end).toBeLessThanOrEqual(text.length)
            cursor = range.end
          }
          expect(cursor).toBeLessThanOrEqual(text.length)
        }),
      )
    })
  })
})
