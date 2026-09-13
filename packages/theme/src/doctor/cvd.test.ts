import { describe, expect, it } from 'vitest'
import type { Colour } from '../colour/oklch.ts'
import { DEFICIENCIES, deltaEOklab, pairSeparation, simulate, worstSeparation } from './cvd.ts'

const red: Colour = { lightness: 55, chroma: 0.2, hue: 27 }
const green: Colour = { lightness: 55, chroma: 0.15, hue: 150 }
const blue: Colour = { lightness: 55, chroma: 0.15, hue: 250 }

describe('simulate', () => {
  it('collapses red and green towards each other for deutan vision', () => {
    const normal = deltaEOklab(red, green)
    const deutan = deltaEOklab(simulate(red, 'deutan'), simulate(green, 'deutan'))
    expect(deutan).toBeLessThan(normal)
  })

  it('leaves a grey alone whichever deficiency is simulated', () => {
    const grey: Colour = { lightness: 50, chroma: 0, hue: 0 }
    for (const deficiency of DEFICIENCIES) {
      expect(simulate(grey, deficiency).chroma).toBeLessThan(0.01)
      expect(simulate(grey, deficiency).lightness).toBeCloseTo(50, 0)
    }
  })

  it('changes blue most for tritan vision', () => {
    const shifts = DEFICIENCIES.map((deficiency) => deltaEOklab(blue, simulate(blue, deficiency)))
    expect(Math.max(...shifts)).toBe(shifts[DEFICIENCIES.indexOf('tritan')])
  })
})

describe('deltaEOklab', () => {
  it('is zero for a colour against itself', () => {
    expect(deltaEOklab(red, red)).toBeCloseTo(0, 9)
  })

  it('is on the 0 to 100 scale the colour rules quote', () => {
    expect(
      deltaEOklab({ lightness: 0, chroma: 0, hue: 0 }, { lightness: 100, chroma: 0, hue: 0 }),
    ).toBeCloseTo(100, 0)
  })
})

describe('worstSeparation', () => {
  it('finds the closest pair in the set', () => {
    const nearlyRed: Colour = { lightness: 56, chroma: 0.19, hue: 29 }
    const worst = worstSeparation(['red', red], ['nearly red', nearlyRed], ['blue', blue])
    expect(worst.pair).toEqual(['red', 'nearly red'])
  })

  it('reports deuteranopia as the deficiency that closes a red and a green', () => {
    expect(worstSeparation(['red', red], ['green', green]).deficiency).toBe('deutan')
  })

  it('reduces a single pair to the same measurement', () => {
    const pair = pairSeparation('red', red, 'green', green)
    expect(pair.pair).toEqual(['red', 'green'])
    expect(pair.deltaE).toBeGreaterThan(0)
  })
})
