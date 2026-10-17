import { describe, expect, it } from 'vitest'
import { grid } from '../builtin/grid.ts'
import { buildPalettes } from '../colour/palette.ts'
import { brandDistance, keepsTheFeel, weightedDeltaE } from './feel.ts'

const teal = { lightness: 30, chroma: 0.05, hue: 190 }

describe('weightedDeltaE', () => {
  it('is nought for the same colour', () => {
    expect(weightedDeltaE(teal, teal)).toBe(0)
  })

  it('weighs a loss of colour above the same step in lightness', () => {
    const lighter = { ...teal, lightness: 32 }
    const quieter = { ...teal, chroma: 0.03 }
    expect(weightedDeltaE(teal, quieter)).toBeGreaterThan(weightedDeltaE(teal, lighter))
  })

  it('counts a turn of hue, scaled by how much colour there is to turn', () => {
    expect(weightedDeltaE(teal, { ...teal, hue: 220 })).toBeGreaterThan(0)
    const grey = { lightness: 30, chroma: 0, hue: 190 }
    expect(weightedDeltaE(grey, { ...grey, hue: 220 })).toBe(0)
  })
})

describe('keepsTheFeel', () => {
  it('keeps a tinted wash tinted and its hue where it was', () => {
    expect(keepsTheFeel('accentSubtle', teal, { ...teal, chroma: 0.045 })).toBe(true)
    expect(keepsTheFeel('accentSubtle', teal, { ...teal, lightness: 36 })).toBe(true)
  })

  it('refuses a wash that has gone grey, or an accent that has lost its strength', () => {
    expect(keepsTheFeel('accentSubtle', teal, { ...teal, chroma: 0.015 })).toBe(false)
    const accent = { lightness: 50, chroma: 0.12, hue: 190 }
    expect(keepsTheFeel('accent', accent, { ...accent, chroma: 0.04 })).toBe(false)
  })

  it('refuses a turn of the brand’s hue, and lets a wash follow the page’s undertone', () => {
    const accent = { lightness: 50, chroma: 0.12, hue: 190 }
    expect(keepsTheFeel('accent', accent, { ...accent, hue: 200 })).toBe(false)
    expect(keepsTheFeel('accentSubtle', teal, { ...teal, hue: 200 })).toBe(true)
  })

  it('asks nothing of a colour that was grey to begin with, or of a role that is not the brand’s', () => {
    const grey = { lightness: 30, chroma: 0.01, hue: 190 }
    expect(keepsTheFeel('accentSubtle', grey, { ...grey, chroma: 0, hue: 0 })).toBe(true)
    expect(keepsTheFeel('surface', teal, { ...teal, chroma: 0 })).toBe(true)
  })
})

const withDarkWash = (css: string) =>
  buildPalettes({
    ...grid,
    overrides: { ...grid.overrides, dark: { '--palette-accent-subtle': css } },
  })

describe('brandDistance', () => {
  it('sums how far the brand’s colours moved, lightness counting least', () => {
    const palettes = buildPalettes(grid)
    expect(brandDistance(palettes, palettes)).toBe(0)
    const quieter = withDarkWash('oklch(30% 0.045 190)')
    const lighter = withDarkWash('oklch(30.5% 0.05 190)')
    expect(brandDistance(palettes, quieter)).toBeGreaterThan(0)
    expect(brandDistance(palettes, lighter)).toBeLessThan(brandDistance(palettes, quieter))
  })
})
