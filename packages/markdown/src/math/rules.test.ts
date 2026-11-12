import { describe, expect, it } from 'vitest'

import { closesInlineMath, inlineMathSpans, opensInlineMath } from './rules.ts'

describe('what opens inline math', () => {
  it('is a dollar followed by something that is not space, and not itself after a dollar', () => {
    expect(opensInlineMath(' ', 'x')).toBe(true)
    expect(opensInlineMath('', '5')).toBe(true)
    expect(opensInlineMath(' ', ' ')).toBe(false)
    expect(opensInlineMath(' ', '')).toBe(false)
    expect(opensInlineMath(' ', '$')).toBe(false)
    expect(opensInlineMath('$', 'x')).toBe(false)
  })
})

describe('what closes inline math', () => {
  it('is a dollar after something that is not space and before something that is not a digit or a dollar', () => {
    expect(closesInlineMath('x', ' ')).toBe(true)
    expect(closesInlineMath('x', '')).toBe(true)
    expect(closesInlineMath('x', '.')).toBe(true)
    expect(closesInlineMath(' ', 'x')).toBe(false)
    expect(closesInlineMath('', 'x')).toBe(false)
    expect(closesInlineMath('x', '5')).toBe(false)
    expect(closesInlineMath('x', '$')).toBe(false)
  })
})

const spans = (source: string) =>
  inlineMathSpans(source).map(({ open, close }) => source.slice(open, close + 1))

describe('the spans of inline math in a line of prose', () => {
  it('finds each pair of dollars that opens and closes', () => {
    expect(spans('then $x$ and $y^2$ too')).toEqual(['$x$', '$y^2$'])
  })

  it('leaves prices alone, which is what the closing rule is for', () => {
    expect(spans('from $501 to $2,500')).toEqual([])
    expect(spans('it costs $5 or 6$ now')).toEqual(['$5 or 6$'])
    expect(spans('a $5 fee and a $10 fee')).toEqual([])
    expect(spans('$5 and $6 and $7')).toEqual([])
  })

  it('does not pair across a dollar that cannot close, so the next one may open', () => {
    expect(spans('$a $b$')).toEqual(['$b$'])
  })

  it('reads an escaped dollar inside as part of the formula, and an escaped one outside as prose', () => {
    expect(spans(String.raw`$a\$b$`)).toEqual([String.raw`$a\$b$`])
    expect(spans(String.raw`\$x\$`)).toEqual([])
  })

  it('keeps going over a line ending, which is space and so cannot close', () => {
    expect(spans('$a\nb$')).toEqual(['$a\nb$'])
    expect(spans('$a\n$ b')).toEqual([])
  })

  it('lets a dollar open straight after an escaped one, which is a dollar sign and not half a pair', () => {
    expect(spans(String.raw`\$$x$ here`)).toEqual(['$x$'])
  })

  it('never pairs the dollars of a doubled one', () => {
    expect(spans('$$x$$')).toEqual([])
  })
})
