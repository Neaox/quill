import { describe, expect, it } from 'vitest'

import { isInGamut, parseColour } from '../colour/oklch.ts'
import {
  COLOUR_FAMILIES,
  INTENSITIES,
  choiceOfColour,
  familyOf,
  intensityOf,
  paintedColour,
} from './colour-choice.ts'
import { writeColour } from './write-colour.ts'

describe('familyOf', () => {
  it('names each family by its own hue', () => {
    for (const family of COLOUR_FAMILIES) expect(familyOf(family.hue)).toBe(family)
  })

  it('names a hue by the nearest family, across the wrap at 360', () => {
    expect(familyOf(184).name).toBe('Teal')
    expect(familyOf(12).name).toBe('Red')
    expect(familyOf(2).name).toBe('Pink')
  })
})

describe('intensityOf', () => {
  it('names each intensity by its own chroma', () => {
    for (const intensity of INTENSITIES) expect(intensityOf(intensity.chroma)).toBe(intensity)
  })

  it('names a chroma by the nearest intensity, at either end', () => {
    expect(intensityOf(0).name).toBe('Quiet')
    expect(intensityOf(0.37).name).toBe('Bold')
    expect(intensityOf(0.12).name).toBe('Balanced')
  })
})

describe('paintedColour', () => {
  it('paints at the light accent’s lightness when the choice states none', () => {
    expect(paintedColour({ hue: 250, chroma: 0.1 }).lightness).toBe(55)
  })

  it('paints at the choice’s own lightness', () => {
    expect(paintedColour({ hue: 250, chroma: 0.1, lightness: 40 }).lightness).toBe(40)
  })

  it('brings a vivid choice into sRGB by chroma alone', () => {
    const painted = paintedColour({ hue: 150, chroma: 0.37 })
    expect(isInGamut(painted)).toBe(true)
    expect(painted.hue).toBe(150)
    expect(painted.chroma).toBeLessThan(0.37)
  })
})

/** An 8-bit colour, through a brand choice and back to hex. */
const roundTrip = (hex: string) => {
  const colour = parseColour(hex)
  if (colour === undefined) throw new Error(`${hex} did not parse`)
  return writeColour(paintedColour(choiceOfColour(colour)), 'hex')
}

describe('choiceOfColour', () => {
  it('keeps the hue, the chroma and the exact lightness, rounded', () => {
    expect(choiceOfColour({ lightness: 57.0504, chroma: 0.098_289, hue: 184.009_74 })).toEqual({
      hue: 184.01,
      chroma: 0.0983,
      lightness: 57.05,
    })
  })

  it('comes back as the same 8-bit colour', () => {
    for (const hex of ['#0f8a7e', '#c9a24b', '#1d1b18', '#ff0000']) expect(roundTrip(hex)).toBe(hex)
  })

  it('holds the chroma to the schema’s ceiling', () => {
    expect(choiceOfColour({ lightness: 50, chroma: 0.5, hue: 150 }).chroma).toBe(0.37)
  })

  it('wraps a hue that rounds to 360 back to 0, which the schema accepts', () => {
    expect(choiceOfColour({ lightness: 50, chroma: 0.1, hue: 359.997 }).hue).toBe(0)
  })
})
