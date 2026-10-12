import { describe, expect, it } from 'vitest'

import { isInGamut } from '../colour/oklch.ts'
import { readColour, type ColourFormat } from './read-colour.ts'

/** #0f8a7e, the teal every row below writes in a different notation. */
const TEAL = { lightness: 57.05, chroma: 0.0983, hue: 184.01 }

const readOk = (input: string) => {
  const result = readColour(input)
  if (!result.ok) throw new Error(`expected ${input} to read, got ${result.error.kind}`)
  return result.value
}

describe('readColour', () => {
  it.each<[string, ColourFormat]>([
    ['#0f8a7e', 'hex'],
    ['#0F8A7E', 'hex'],
    ['#0f8a7e80', 'hex'],
    ['  #0f8a7e  ', 'hex'],
    ['rgb(15 138 126)', 'rgb'],
    ['rgb(15, 138, 126)', 'rgb'],
    ['RGBA(15, 138, 126, 0.5)', 'rgb'],
    ['rgb(5.88% 54.12% 49.41%)', 'rgb'],
    ['15, 138, 126', 'triple'],
    ['15 138 126', 'triple'],
    ['oklch(57.05% 0.0983 184.01)', 'oklch'],
    ['oklch(0.5705 0.0983 184.01deg)', 'oklch'],
    ['oklab(0.5705 -0.098 -0.0069)', 'oklab'],
  ])('reads %s as %s', (input, format) => {
    const read = readOk(input)
    expect(read.format).toBe(format)
    expect(read.colour.lightness).toBeCloseTo(TEAL.lightness, 0)
    expect(read.colour.chroma).toBeCloseTo(TEAL.chroma, 2)
    expect(read.colour.hue).toBeCloseTo(TEAL.hue, -1)
    expect(read.broughtIntoGamut).toBe(false)
  })

  it('drops alpha, because an accent is opaque', () => {
    expect(readOk('#0f8a7e80').colour.alpha).toBeUndefined()
  })

  it.each<[string, ColourFormat]>([
    ['#0f8', 'hex'],
    ['hsl(174 80% 30%)', 'hsl'],
    ['hsl(174, 80%, 30%)', 'hsl'],
    ['hsla(174deg, 80%, 30%, 1)', 'hsl'],
    ['hsl(0.4833turn 80% 30%)', 'hsl'],
    ['hwb(174 5% 40%)', 'hwb'],
    ['lab(50% 40 30)', 'lab'],
    ['lch(50% 40 30)', 'lch'],
    ['teal', 'named'],
    ['RebeccaPurple', 'named'],
    ['cmyk(89%, 0%, 9%, 46%)', 'cmyk'],
    ['CMYK(89 0 9 46)', 'cmyk'],
  ])('reads %s as %s', (input, format) => {
    expect(readOk(input).format).toBe(format)
  })

  it('reads the same hue from HSL in degrees and in turns', () => {
    expect(readOk('hsl(0.5turn 80% 30%)').colour.hue).toBeCloseTo(
      readOk('hsl(180deg 80% 30%)').colour.hue,
      3,
    )
  })

  it('reads CMYK by the naive conversion, without a profile', () => {
    const cmyk = readOk('cmyk(0%, 100%, 100%, 0%)').colour
    const red = readOk('#ff0000').colour
    expect(cmyk.hue).toBeCloseTo(red.hue, 3)
    expect(cmyk.lightness).toBeCloseTo(red.lightness, 3)
  })

  it('brings a colour outside sRGB in by chroma, keeping hue and lightness, and says so', () => {
    const read = readOk('oklch(70% 0.4 150)')
    expect(read.broughtIntoGamut).toBe(true)
    expect(isInGamut(read.colour)).toBe(true)
    expect(read.colour.hue).toBe(150)
    expect(read.colour.lightness).toBe(70)
    expect(read.colour.chroma).toBeLessThanOrEqual(0.37)
  })

  it('refuses an empty field', () => {
    expect(readColour('   ')).toEqual({ ok: false, error: { kind: 'empty' } })
  })

  it.each(['pantone 3278 c', '%%%', '(15, 138, 126)'])('does not recognise %s', (input) => {
    expect(readColour(input)).toEqual({ ok: false, error: { kind: 'unrecognised' } })
  })

  it.each<[string, ColourFormat]>([
    ['#0f8a7', 'hex'],
    ['#zzzzzz', 'hex'],
    ['rgb(15 138)', 'rgb'],
    ['hsl(teal)', 'hsl'],
    ['256, 0, 0', 'triple'],
    ['15, 138', 'triple'],
    ['cmyk(10%, 20%, 30%)', 'cmyk'],
    ['cmyk(120%, 0%, 0%, 0%)', 'cmyk'],
    ['cmyk(1.2.3%, 0%, 0%, 0%)', 'cmyk'],
    ['notacolour', 'named'],
  ])('reports %s as invalid %s', (input, format) => {
    expect(readColour(input)).toEqual({ ok: false, error: { kind: 'invalid', format } })
  })
})
