import { describe, expect, it } from 'vitest'
import { contrastRatio } from './wcag.ts'

const white = { lightness: 100, chroma: 0, hue: 0 }
const black = { lightness: 0, chroma: 0, hue: 0 }

describe('contrastRatio', () => {
  it('is 21 between black and white, in either order', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5)
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5)
  })

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
  })
})
