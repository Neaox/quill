import { describe, expect, it } from 'vitest'

import { cleanText } from './plain-text.ts'

/** Named, because the characters themselves are invisible in a diff. */
const char = (codePoint: number) => String.fromCodePoint(codePoint)
const NUL = char(0x00)
const ESC = char(0x1b)
const NEL = char(0x85)
const LINE_SEPARATOR = char(0x2028)
const RIGHT_TO_LEFT_OVERRIDE = char(0x202e)
const POP_DIRECTIONAL_FORMATTING = char(0x202c)
const LEFT_TO_RIGHT_ISOLATE = char(0x2066)
const POP_DIRECTIONAL_ISOLATE = char(0x2069)
const ZERO_WIDTH_SPACE = char(0x200b)
const BYTE_ORDER_MARK = char(0xfeff)
const ZERO_WIDTH_JOINER = char(0x200d)

describe('cleanText', () => {
  it('trims and collapses whitespace, newlines and tabs to single spaces', () => {
    expect(cleanText('  Hello \n\t  world  ', 100)).toBe('Hello world')
  })

  it('turns control characters into spaces, so a title cannot forge a second line', () => {
    expect(cleanText(`Real${NUL}${ESC}[31m title${NEL}next${LINE_SEPARATOR}line`, 100)).toBe(
      'Real [31m title next line',
    )
  })

  it('removes bidirectional overrides, which would make one domain read as another', () => {
    expect(
      cleanText(`good${RIGHT_TO_LEFT_OVERRIDE}elgoog.com${POP_DIRECTIONAL_FORMATTING}`, 100),
    ).toBe('goodelgoog.com')
    expect(cleanText(`${LEFT_TO_RIGHT_ISOLATE}isolated${POP_DIRECTIONAL_ISOLATE}`, 100)).toBe(
      'isolated',
    )
  })

  it('removes zero-width characters but keeps the joiner emoji sequences need', () => {
    expect(cleanText(`a${ZERO_WIDTH_SPACE}b${BYTE_ORDER_MARK}c`, 100)).toBe('abc')
    const technologist = `👩${ZERO_WIDTH_JOINER}💻`
    expect(cleanText(technologist, 100)).toBe(technologist)
  })

  it('answers null for nothing, and for text that is nothing once cleaned', () => {
    expect(cleanText(null, 10)).toBeNull()
    expect(cleanText(undefined, 10)).toBeNull()
    expect(cleanText(`  \n${ZERO_WIDTH_SPACE} `, 10)).toBeNull()
  })

  it('caps at the limit with an ellipsis, counting the ellipsis', () => {
    const capped = cleanText('abcdefghij', 5)
    expect(capped).toBe('abcd…')
    expect(Array.from(capped ?? '')).toHaveLength(5)
  })

  it('leaves text at exactly the limit alone', () => {
    expect(cleanText('abcde', 5)).toBe('abcde')
  })

  it('never cuts an astral character in half', () => {
    const capped = cleanText('😀😀😀😀😀😀', 4)
    expect(capped).toBe('😀😀😀…')
    expect(capped).not.toContain('�')
  })

  it('does not leave a space before the ellipsis', () => {
    expect(cleanText('abc defghi', 5)).toBe('abc…')
  })
})
