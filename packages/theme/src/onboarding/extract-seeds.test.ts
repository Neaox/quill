import { describe, expect, it } from 'vitest'
import { CHROMA_BUDGET } from '../colour/bands.ts'
import { extractSeedsFromColours } from './extract-seeds.ts'

/** The brand from the onboarding artboard: a deep green, an ink, a paper, a gold. */
const northwind = ['#0F5C4E', '#1D1B18', '#F4EFE6', '#C9A24B']

describe('extractSeedsFromColours', () => {
  it('takes the most chromatic colour as the accent candidate', () => {
    const seeds = extractSeedsFromColours(northwind)
    expect(seeds.accent.hue).toBeGreaterThan(80)
    expect(seeds.accent.hue).toBeLessThan(180)
    expect(seeds.candidates[0]?.chroma).toBe(seeds.accent.chroma)
  })

  it('orders the candidates by chroma, most first', () => {
    const chromas = extractSeedsFromColours(northwind).candidates.map((colour) => colour.chroma)
    expect(chromas).toEqual([...chromas].toSorted((a, b) => b - a))
  })

  it('takes the warmth of the brand neutrals as the tone, inside the paper budget', () => {
    const seeds = extractSeedsFromColours(northwind)
    expect(seeds.tone.chroma).toBeGreaterThanOrEqual(CHROMA_BUDGET.paperTintMinimum)
    expect(seeds.tone.chroma).toBeLessThanOrEqual(CHROMA_BUDGET.paper)
  })

  it('says when the accent is dark enough to be text as well as a mark', () => {
    expect(extractSeedsFromColours(['#0F5C4E']).accentIsTextSafe).toBe(true)
    expect(extractSeedsFromColours(['#FFE08A']).accentIsTextSafe).toBe(false)
  })

  it('ignores anything that is not a colour', () => {
    expect(extractSeedsFromColours(['not a colour', '#0F5C4E']).candidates).toHaveLength(1)
  })

  it('falls back to the default seeds when a logo yields nothing', () => {
    const seeds = extractSeedsFromColours([])
    expect(seeds.candidates).toEqual([])
    expect(seeds.accent).toEqual({ hue: 45, chroma: 0.16, lightness: 55 })
    expect(seeds.accentIsTextSafe).toBe(false)
  })

  it('uses the accent itself for the tone when every brand colour is chromatic', () => {
    const seeds = extractSeedsFromColours(['#0F5C4E', '#C9A24B'])
    expect(seeds.tone.hue).toBeCloseTo(seeds.accent.hue, 5)
  })
})
