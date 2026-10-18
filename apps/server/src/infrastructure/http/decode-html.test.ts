import { describe, expect, it } from 'vitest'

import { decodeHtml } from './decode-html.ts'

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (text: string) => new TextEncoder().encode(text)

describe('decodeHtml', () => {
  it('uses the header charset first', () => {
    // 0xE9 is "é" in latin1 and an invalid sequence in UTF-8.
    expect(decodeHtml(bytes(0x63, 0x61, 0x66, 0xe9), 'iso-8859-1')).toBe('café')
  })

  it('falls back to the meta tag when the header names none', () => {
    const page = Uint8Array.from([
      ...ascii('<meta charset="iso-8859-1"><title>caf'),
      0xe9,
      ...ascii('</title>'),
    ])
    expect(decodeHtml(page, null)).toContain('café')
  })

  it('reads the older http-equiv form of the meta tag', () => {
    const page = Uint8Array.from([
      ...ascii('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">'),
      0x80,
    ])
    expect(decodeHtml(page, null)).toContain('€')
  })

  it('defaults to UTF-8', () => {
    expect(decodeHtml(ascii('<title>naïve ✓</title>'), null)).toBe('<title>naïve ✓</title>')
  })

  it('ignores a label no decoder knows and carries on to the next source', () => {
    expect(decodeHtml(ascii('<title>ok</title>'), 'x-not-an-encoding')).toBe('<title>ok</title>')
    const page = Uint8Array.from([...ascii('<meta charset="nonsense">caf'), 0xc3, 0xa9])
    expect(decodeHtml(page, null)).toContain('café')
  })

  it('never throws on invalid bytes; they become the replacement character', () => {
    expect(decodeHtml(bytes(0xff, 0xfe, 0x41), 'utf-8')).toContain('�')
  })

  it('does not look for a meta tag beyond the first kilobyte', () => {
    const padding = ' '.repeat(2000)
    const page = Uint8Array.from([...ascii(`${padding}<meta charset="iso-8859-1">`), 0xe9])
    expect(decodeHtml(page, null)).not.toContain('é')
  })
})
