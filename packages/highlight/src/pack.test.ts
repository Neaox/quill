import {
  array,
  assert,
  constantFrom,
  integer,
  nat,
  property,
  tuple,
  type Arbitrary,
} from 'fast-check'
import { describe, expect, it } from 'vitest'

import { packRanges, unpackRanges } from './pack.ts'
import { TOKEN_CLASSES, type TokenRange } from './tokens.ts'

/** A random, non-overlapping, ascending list of token ranges. */
const rangesArbitrary: Arbitrary<TokenRange[]> = array(
  tuple(nat({ max: 40 }), integer({ min: 1, max: 40 }), constantFrom(...TOKEN_CLASSES)),
  { maxLength: 20 },
).map((triples) => {
  let cursor = 0
  const ranges: TokenRange[] = []
  for (const [gap, length, type] of triples) {
    const start = cursor + gap
    ranges.push({ start, end: start + length, type })
    cursor = start + length
  }
  return ranges
})

describe('packRanges / unpackRanges', () => {
  it('round-trips an empty list', () => {
    expect(unpackRanges(packRanges([]))).toEqual([])
  })

  it('round-trips a single range', () => {
    const ranges: TokenRange[] = [{ start: 0, end: 5, type: 'keyword' }]
    expect(unpackRanges(packRanges(ranges))).toEqual(ranges)
  })

  it('produces a string safe for an HTML attribute', () => {
    const packed = packRanges([
      { start: 0, end: 5, type: 'keyword' },
      { start: 5, end: 10, type: 'string' },
    ])
    expect(packed).toMatch(/^[0-9a-z,:;]+$/)
  })

  it('throws on a triple with the wrong shape', () => {
    expect(() => unpackRanges('1:0,5')).toThrow(/malformed/)
    expect(() => unpackRanges('1:0,5,0,0')).toThrow(/malformed/)
  })

  it('throws on non-numeric fields', () => {
    expect(() => unpackRanges('1:!,5,0')).toThrow(/malformed/)
    expect(() => unpackRanges('1:0,!,0')).toThrow(/malformed/)
  })

  it('throws on a type index outside TOKEN_CLASSES', () => {
    expect(() => unpackRanges('1:0,5,zz')).toThrow(/malformed/)
  })

  it('throws on a negative field rather than reading it as an offset', () => {
    expect(() => unpackRanges('1:-1,5,0')).toThrow(/malformed/)
    expect(() => unpackRanges('1:0,-5,0')).toThrow(/malformed/)
    expect(() => unpackRanges('1:0,5,-1')).toThrow(/malformed/)
  })

  it('reads the version prefix rather than skipping past the first colon', () => {
    expect(packRanges([])).toBe('1:')
    expect(packRanges([{ start: 0, end: 5, type: 'keyword' }]).startsWith('1:')).toBe(true)
  })

  it('refuses a payload with no version prefix', () => {
    expect(() => unpackRanges('0,5,0')).toThrow(/no version prefix/)
    expect(() => unpackRanges('')).toThrow(/no version prefix/)
  })

  it('refuses a version this build has never shipped', () => {
    expect(() => unpackRanges('2:0,5,0')).toThrow(/unsupported packed token range version "2"/)
    expect(() => unpackRanges(':0,5,0')).toThrow(/unsupported packed token range version ""/)
  })

  it('property: unpack(pack(x)) equals x for any tiling range list', () => {
    assert(
      property(rangesArbitrary, (ranges) => {
        expect(unpackRanges(packRanges(ranges))).toEqual(ranges)
      }),
    )
  })
})
