import { describe, expect, it } from 'vitest'
import type { Colour } from '../colour/oklch.ts'
import { apcaContrast, apcaLc } from './apca.ts'

const white: Colour = { lightness: 100, chroma: 0, hue: 0 }
const black: Colour = { lightness: 0, chroma: 0, hue: 0 }

describe('apcaContrast', () => {
  it('is positive for dark text on light paper and negative the other way', () => {
    expect(apcaContrast(black, white)).toBeGreaterThan(100)
    expect(apcaContrast(white, black)).toBeLessThan(-100)
  })

  it('reports the magnitude as Lc', () => {
    expect(apcaLc(white, black)).toBeCloseTo(Math.abs(apcaContrast(white, black)), 6)
  })

  it('clamps a colour the display cannot show before measuring it', () => {
    const beyondGamut: Colour = { lightness: 60, chroma: 0.34, hue: 250 }
    expect(Number.isFinite(apcaLc(beyondGamut, white))).toBe(true)
  })
})
