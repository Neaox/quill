import { describe, expect, it } from 'vitest'
import {
  formatOklch,
  fromCulori,
  isInGamut,
  mapIntoGamut,
  mix,
  parseColour,
  toCulori,
  toOklab,
  toRgb,
  withAlpha,
  withChroma,
  withLightness,
  type Colour,
} from './oklch.ts'

const paper: Colour = { lightness: 98.5, chroma: 0.008, hue: 85 }

describe('culori boundary', () => {
  it('converts lightness between percent and unit scales', () => {
    expect(toCulori(paper)).toEqual({ mode: 'oklch', l: 0.985, c: 0.008, h: 85 })
    expect(fromCulori({ mode: 'oklch', l: 0.985, c: 0.008, h: 85 })).toEqual(paper)
  })

  it('carries alpha only when it is set', () => {
    expect(toCulori(withAlpha(paper, 0.4)).alpha).toBe(0.4)
    expect(fromCulori({ mode: 'oklch', l: 0.5, c: 0, h: 0, alpha: 0.25 }).alpha).toBe(0.25)
    expect(fromCulori({ mode: 'oklch', l: 0.5, c: 0, h: 0 }).alpha).toBeUndefined()
  })

  it('treats a missing hue as zero', () => {
    expect(fromCulori({ mode: 'oklch', l: 0.5, c: 0 }).hue).toBe(0)
  })

  it('converts to sRGB and OKLab', () => {
    expect(toRgb(paper).mode).toBe('rgb')
    expect(toOklab(paper).mode).toBe('oklab')
  })
})

describe('parseColour', () => {
  it('reads any CSS colour the browser would', () => {
    const parsed = parseColour('#ff0000')
    expect(parsed?.hue).toBeCloseTo(29.23, 1)
  })

  it('returns undefined for something that is not a colour', () => {
    expect(parseColour('not-a-colour')).toBeUndefined()
  })
})

describe('gamut mapping', () => {
  it('leaves a colour that already fits alone', () => {
    const result = mapIntoGamut(paper)
    expect(result.chromaReducedBy).toBe(0)
    expect(result.colour).toBe(paper)
    expect(isInGamut(paper)).toBe(true)
  })

  it('reduces chroma, keeping lightness and hue', () => {
    const wild: Colour = { lightness: 60, chroma: 0.34, hue: 250 }
    expect(isInGamut(wild)).toBe(false)
    const result = mapIntoGamut(wild)
    expect(result.chromaReducedBy).toBeGreaterThan(0)
    expect(result.colour.lightness).toBe(60)
    expect(result.colour.hue).toBe(250)
    expect(result.colour.chroma).toBeLessThan(wild.chroma)
    expect(isInGamut(result.colour)).toBe(true)
  })
})

describe('channel helpers', () => {
  it('replaces one channel at a time', () => {
    expect(withLightness(paper, 20).lightness).toBe(20)
    expect(withChroma(paper, 0.2).chroma).toBe(0.2)
    expect(withAlpha(paper, 0.5).alpha).toBe(0.5)
  })
})

describe('mix', () => {
  it('returns the background at nothing and the colour at everything', () => {
    const accent: Colour = { lightness: 50, chroma: 0.15, hue: 25 }
    expect(mix(accent, paper, 0).lightness).toBeCloseTo(paper.lightness, 4)
    expect(mix(accent, paper, 1).lightness).toBeCloseTo(accent.lightness, 4)
  })

  it('lands between the two at a proportion', () => {
    const accent: Colour = { lightness: 50, chroma: 0.15, hue: 25 }
    const tint = mix(accent, paper, 0.11)
    expect(tint.lightness).toBeLessThan(paper.lightness)
    expect(tint.lightness).toBeGreaterThan(accent.lightness)
    expect(tint.chroma).toBeLessThan(accent.chroma)
  })
})

describe('formatOklch', () => {
  it('writes the form tokens.css uses', () => {
    expect(formatOklch(paper)).toBe('oklch(98.5% 0.008 85)')
  })

  it('rounds to the precision the token file keeps', () => {
    expect(formatOklch({ lightness: 98.5432, chroma: 0.00812345, hue: 85.44 })).toBe(
      'oklch(98.54% 0.0081 85.4)',
    )
  })

  it('writes alpha as a percentage, and omits it when opaque', () => {
    expect(formatOklch(withAlpha(paper, 0.4))).toBe('oklch(98.5% 0.008 85 / 40%)')
    expect(formatOklch(withAlpha(paper, 1))).toBe('oklch(98.5% 0.008 85)')
  })
})
