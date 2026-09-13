import { describe, expect, it } from 'vitest'

import { asciiFallback, contentDisposition, extendedValue } from './content-disposition.ts'

/**
 * RFC 6266, and the two things that go wrong without it: a name a header
 * cannot carry, and a name that carries more than a name.
 */

describe('asciiFallback', () => {
  it('leaves an ordinary name alone', () => {
    expect(asciiFallback('Architecture diagram (v2).png')).toBe('Architecture diagram (v2).png')
  })

  it('replaces everything a header field cannot carry with an underscore', () => {
    expect(asciiFallback('設計図.png')).toBe('___.png')
    // One underscore for the emoji, not two: the pattern matches code points
    // rather than UTF-16 units, so a surrogate pair is one character.
    expect(asciiFallback('holiday 🏖.jpg')).toBe('holiday _.jpg')
    expect(asciiFallback('café.png')).toBe('caf_.png')
  })

  it('removes the characters that would end the quoted string or start a parameter', () => {
    expect(asciiFallback('a"b\\c;d.png')).toBe('abcd.png')
    expect(asciiFallback('x"; filename="evil.exe')).toBe('x filename=evil.exe')
  })

  it('names the file itself when nothing readable survives', () => {
    expect(asciiFallback('設計図')).toBe('___')
    expect(asciiFallback('";;')).toBe('attachment')
    expect(asciiFallback('')).toBe('attachment')
  })
})

describe('extendedValue', () => {
  it('carries the real name, percent-encoded from its UTF-8 bytes', () => {
    expect(extendedValue('設計図.png')).toBe("UTF-8''%E8%A8%AD%E8%A8%88%E5%9B%B3.png")
    expect(extendedValue('holiday 🏖.jpg')).toBe("UTF-8''holiday%20%F0%9F%8F%96.jpg")
  })

  it('encodes the characters the grammar reserves that `encodeURIComponent` leaves', () => {
    expect(extendedValue("it's (a) *star*!.png")).toBe(
      "UTF-8''it%27s%20%28a%29%20%2Astar%2A%21.png",
    )
  })

  it('leaves the characters the grammar allows unencoded', () => {
    expect(extendedValue('a-b_c.d~e.png')).toBe("UTF-8''a-b_c.d~e.png")
  })
})

describe('contentDisposition', () => {
  it('emits both parameters, always', () => {
    expect(contentDisposition('inline', 'diagram.png')).toBe(
      'inline; filename="diagram.png"; filename*=UTF-8\'\'diagram.png',
    )
    expect(contentDisposition('attachment', '設計図.pdf')).toBe(
      'attachment; filename="___.pdf"; filename*=UTF-8\'\'%E8%A8%AD%E8%A8%88%E5%9B%B3.pdf',
    )
  })

  it('never lets a name introduce a parameter of its own', () => {
    const header = contentDisposition('inline', 'x"; filename="evil.exe')

    // The header has exactly the structure this builder emits: a disposition
    // and two parameters. A name that could end the quoted string early, or
    // start a parameter, would show up as a third.
    const parts = header.split(';')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('inline')
    expect(parts[1]?.trim()).toMatch(/^filename="[^"\\;]*"$/u)
    expect(parts[2]?.trim()).toMatch(/^filename\*=UTF-8''\S*$/u)
    // The dangerous reading — a second `filename` parameter naming a program —
    // never forms: what is left of it is inside the quoted string.
    expect(header).not.toContain('"evil.exe"')
  })
})
