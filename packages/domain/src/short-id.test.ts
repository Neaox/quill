import { describe, expect, it } from 'vitest'

import {
  canonicalShortId,
  SHORT_ID_ALPHABET,
  SHORT_ID_BYTES,
  SHORT_ID_LENGTH,
  shortIdFrom,
} from './short-id.ts'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

describe('SHORT_ID_ALPHABET', () => {
  it('is Crockford base-32, lower-case, without the confusable letters', () => {
    expect(SHORT_ID_ALPHABET).toHaveLength(32)
    expect(SHORT_ID_ALPHABET).toBe('0123456789abcdefghjkmnpqrstvwxyz')
    for (const letter of 'ilou') expect(SHORT_ID_ALPHABET).not.toContain(letter)
  })
})

describe('shortIdFrom', () => {
  it('encodes fifty bits as ten alphabet characters', () => {
    const key = shortIdFrom(bytes(0, 0, 0, 0, 0, 0, 0))
    expect(key).toHaveLength(SHORT_ID_LENGTH)
    expect(key).toBe('0000000000')
  })

  it('encodes each five-bit group in order, most significant first', () => {
    // 0xff bytes set every bit, so every group is the last letter.
    expect(shortIdFrom(bytes(255, 255, 255, 255, 255, 255, 255))).toBe('zzzzzzzzzz')
    // 0b00001_00010_00011_… walks the alphabet one group at a time.
    expect(shortIdFrom(bytes(0x08, 0x86, 0x42, 0x98, 0xe8, 0x48, 0x40))).toBe('1234567891')
  })

  it('ignores bytes beyond the fifty bits it needs', () => {
    const seven = bytes(1, 2, 3, 4, 5, 6, 7)
    expect(shortIdFrom(Uint8Array.from([...seven, 9, 9, 9]))).toBe(shortIdFrom(seven))
  })

  it('refuses fewer bytes than fifty bits need, which is a programmer error', () => {
    expect(() => shortIdFrom(bytes(1, 2, 3, 4, 5, 6))).toThrow(TypeError)
    expect(SHORT_ID_BYTES).toBe(7)
  })

  it('produces only alphabet characters for arbitrary bytes', () => {
    for (let seed = 0; seed < 64; seed++) {
      const key = shortIdFrom(
        Uint8Array.from({ length: 7 }, (_, index) => (seed * 31 + index * 7) % 256),
      )
      expect(key).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/)
    }
  })
})

describe('canonicalShortId', () => {
  it('accepts a canonical key unchanged', () => {
    expect(canonicalShortId('k7m3q9v2xd')).toBe('k7m3q9v2xd')
  })

  it('accepts the forms a person reads aloud or types by hand', () => {
    expect(canonicalShortId('K7M3Q9V2XD')).toBe('k7m3q9v2xd')
    expect(canonicalShortId('k7m3q9v2xI')).toBe('k7m3q9v2x1')
    expect(canonicalShortId('k7m3q9v2xL')).toBe('k7m3q9v2x1')
    expect(canonicalShortId('k7m3q9v2xO')).toBe('k7m3q9v2x0')
  })

  it('rejects anything that is not ten alphabet characters', () => {
    expect(canonicalShortId('k7m3q9v2x')).toBeNull()
    expect(canonicalShortId('k7m3q9v2xdd')).toBeNull()
    expect(canonicalShortId('k7m3q9v2xu')).toBeNull()
    expect(canonicalShortId('k7m3q9v2x-')).toBeNull()
    expect(canonicalShortId('')).toBeNull()
  })
})
