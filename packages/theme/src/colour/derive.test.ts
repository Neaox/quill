import { describe, expect, it } from 'vitest'
import { recordClamp, settleContrast, settleGamut } from './derive.ts'
import type { Colour } from './oklch.ts'

const inGamut: Colour = { lightness: 50, chroma: 0.1, hue: 25 }
const outOfGamut: Colour = { lightness: 60, chroma: 0.34, hue: 250 }

describe('settleGamut', () => {
  it('reports nothing when the colour already fits', () => {
    expect(settleGamut('accent', inGamut).adjustments).toEqual([])
  })

  it('records the chroma the display could not hold', () => {
    const result = settleGamut('accent', outOfGamut)
    expect(result.adjustments).toHaveLength(1)
    expect(result.adjustments[0]).toMatchObject({
      role: 'accent',
      property: 'chroma',
      reason: 'gamut',
      from: outOfGamut.chroma,
    })
    expect(result.colour.chroma).toBeLessThan(outOfGamut.chroma)
  })
})

describe('settleContrast', () => {
  it('leaves a colour that already passes, and records nothing', () => {
    const result = settleContrast('ink', inGamut, () => true)
    expect(result.colour).toEqual(inGamut)
    expect(result.adjustments).toEqual([])
  })

  it('records the lightness move and then the gamut reduction', () => {
    const result = settleContrast('accent', outOfGamut, (candidate) => candidate.lightness <= 55, {
      direction: 'darker',
      step: 1,
    })
    expect(result.adjustments.map((entry) => entry.reason)).toEqual(['contrast', 'gamut'])
    expect(result.colour.lightness).toBe(55)
  })
})

describe('recordClamp', () => {
  it('says nothing when nothing changed', () => {
    expect(recordClamp('accent', 'chroma', 'budget', 0.12, 0.12)).toEqual([])
  })

  it('records a change once', () => {
    expect(recordClamp('accent', 'chroma', 'budget', 0.2, 0.18)).toEqual([
      { role: 'accent', property: 'chroma', reason: 'budget', from: 0.2, to: 0.18 },
    ])
  })
})
