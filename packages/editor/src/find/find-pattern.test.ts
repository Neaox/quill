import { describe, expect, it } from 'vitest'

import { compilePattern, matchCase, matchesIn, replacementFor } from './find-pattern.ts'
import type { FindOptions } from './find-pattern.ts'

const PLAIN: FindOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  preserveCase: false,
}

/** Every match of a query in some text, as the words matched. */
function found(query: string, text: string, options: Partial<FindOptions> = {}): readonly string[] {
  const pattern = compilePattern(query, { ...PLAIN, ...options })
  if (pattern.kind !== 'ok') throw new Error(`The query is ${pattern.kind}.`)
  return [...matchesIn(text, pattern.regex)].map((match) => match[0])
}

describe('compiling what is searched for', () => {
  it('says there is nothing to find for an empty query', () => {
    expect(compilePattern('', PLAIN).kind).toBe('empty')
  })

  it('finds plain text as it is written, without reading it as a pattern', () => {
    expect(found('a.b (c)', 'a.b (c) and axb (c)')).toEqual(['a.b (c)'])
    expect(found('[x]', 'a [x] b x')).toEqual(['[x]'])
  })

  it('ignores case unless asked not to', () => {
    expect(found('plan', 'Plan plan PLAN')).toEqual(['Plan', 'plan', 'PLAN'])
    expect(found('plan', 'Plan plan PLAN', { caseSensitive: true })).toEqual(['plan'])
  })

  it('finds whole words only, where the query begins and ends with word characters', () => {
    expect(found('ship', 'ship shipping ship.', { wholeWord: true })).toEqual(['ship', 'ship'])
    expect(found('ship', 'ship shipping')).toEqual(['ship', 'ship'])
    expect(found('café', 'café cafés', { wholeWord: true })).toEqual(['café'])
  })

  it('leaves the edge alone where the query does not begin or end with a word character', () => {
    expect(found('->', 'a->b', { wholeWord: true })).toEqual(['->'])
  })

  it('reads a regular expression as one, case and whole words included', () => {
    expect(found(String.raw`\d+`, 'a1 b22 c333', { regex: true })).toEqual(['1', '22', '333'])
    expect(found('PL.N', 'plan plXn', { regex: true })).toEqual(['plan', 'plXn'])
    expect(found('a.', 'ab abc a', { regex: true, wholeWord: true })).toEqual(['ab'])
  })

  it('reads Unicode properties in a regular expression', () => {
    expect(
      found(String.raw`\p{Lu}\p{Ll}+`, 'Ada and Émile', { regex: true, caseSensitive: true }),
    ).toEqual(['Ada', 'Émile'])
  })

  it('says an invalid regular expression is invalid, and why', () => {
    const pattern = compilePattern('(unclosed', { ...PLAIN, regex: true })

    expect(pattern.kind).toBe('invalid')
    expect(pattern.kind === 'invalid' ? pattern.message : '').toMatch(/./u)
  })

  it('skips a match that is empty, which is nothing to select or replace', () => {
    expect(found('x*', 'axxb', { regex: true })).toEqual(['xx'])
  })
})

describe('what a match is replaced with', () => {
  const regex = (
    query: string,
    text: string,
    replacement: string,
    options?: Partial<FindOptions>,
  ) => {
    const pattern = compilePattern(query, { ...PLAIN, regex: true, ...options })
    if (pattern.kind !== 'ok') throw new Error('Not ok.')
    const [match] = [...matchesIn(text, pattern.regex)]
    if (match === undefined) throw new Error('No match.')
    return replacementFor(match, replacement, { ...PLAIN, regex: true, ...options })
  }

  it('is the text as written when the query is plain text, dollar signs and all', () => {
    const pattern = compilePattern('cost', PLAIN)
    if (pattern.kind !== 'ok') throw new Error('Not ok.')
    const [match] = [...matchesIn('the cost', pattern.regex)]
    if (match === undefined) throw new Error('No match.')

    expect(replacementFor(match, 'price $1 $&', PLAIN)).toBe('price $1 $&')
  })

  it('takes capture groups, the whole match and named groups from a regular expression', () => {
    expect(regex(String.raw`(\w+)@(\w+)`, 'ada@lab', '$2:$1')).toBe('lab:ada')
    expect(regex(String.raw`\w+`, 'word', '[$&]')).toBe('[word]')
    expect(regex(String.raw`(?<user>\w+)@`, 'ada@', '$<user>!')).toBe('ada!')
    expect(regex('a', 'a', 'costs $$5')).toBe('costs $5')
  })

  it('makes a group that did not take part, or does not exist, nothing', () => {
    expect(regex('(a)|(b)', 'a', '[$2]')).toBe('[]')
    expect(regex('a', 'a', '[$3]')).toBe('[]')
  })

  it('reads two digits as one group only where there is such a group', () => {
    expect(regex('(a)', 'a', '[$12]')).toBe('[a2]')
    expect(regex('(a)|(b)', 'b', '[$12]')).toBe('[2]')
    expect(regex('(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)', 'abcdefghijkl', '[$12]')).toBe('[l]')
  })

  it('makes a named group nothing where the expression names none', () => {
    expect(regex('a', 'a', '[$<x>]')).toBe('[]')
  })

  it('leaves a dollar sign that names nothing as it is', () => {
    expect(regex('a', 'a', 'US$ and $x')).toBe('US$ and $x')
  })

  it('follows the case of what it replaces when asked to', () => {
    const keep = { preserveCase: true }
    expect(regex('plan', 'PLAN', 'scheme', keep)).toBe('SCHEME')
    expect(regex('plan', 'plan', 'Scheme', keep)).toBe('scheme')
    expect(regex('plan', 'Plan', 'scheme', keep)).toBe('Scheme')
    expect(regex('plan', 'pLAn', 'Scheme', keep)).toBe('Scheme')
  })
})

describe('matching the case of what is replaced', () => {
  it.each([
    ['PLAN', 'scheme', 'SCHEME'],
    ['plan', 'Scheme', 'scheme'],
    ['Plan', 'scheme', 'Scheme'],
    ['Plan Of Work', 'scheme', 'Scheme'],
    ['pLan', 'scheme', 'scheme'],
    ['123', 'scheme', 'scheme'],
  ])('%s makes %s into %s', (replaced, replacement, expected) => {
    expect(matchCase(replaced, replacement)).toBe(expected)
  })
})
