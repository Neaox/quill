import { describe, expect, it } from 'vitest'
import {
  CHROMA_BUDGET,
  clampToBand,
  DARK_CHROMA_REDUCTION,
  inBand,
  LIGHTNESS_BANDS,
  TARGET_LIGHTNESS,
} from './bands.ts'

describe('inBand', () => {
  it('includes both ends', () => {
    expect(inBand(96, LIGHTNESS_BANDS.paper.light)).toBe(true)
    expect(inBand(99, LIGHTNESS_BANDS.paper.light)).toBe(true)
    expect(inBand(95.9, LIGHTNESS_BANDS.paper.light)).toBe(false)
    expect(inBand(99.1, LIGHTNESS_BANDS.paper.light)).toBe(false)
  })
})

describe('clampToBand', () => {
  it('pulls a value to the nearer end', () => {
    expect(clampToBand(10, LIGHTNESS_BANDS.accent.light)).toBe(40)
    expect(clampToBand(90, LIGHTNESS_BANDS.accent.light)).toBe(55)
    expect(clampToBand(48, LIGHTNESS_BANDS.accent.light)).toBe(48)
  })
})

describe('the committed system', () => {
  it.each(['paper', 'surface', 'raised', 'border', 'muted', 'ink'] as const)(
    'puts the %s target inside its own band',
    (role) => {
      expect(inBand(TARGET_LIGHTNESS[role].light, LIGHTNESS_BANDS[role].light)).toBe(true)
      expect(inBand(TARGET_LIGHTNESS[role].dark, LIGHTNESS_BANDS[role].dark)).toBe(true)
    },
  )

  it('chooses a dark chroma reduction inside the range the rules give', () => {
    expect(DARK_CHROMA_REDUCTION.chosen).toBeGreaterThanOrEqual(DARK_CHROMA_REDUCTION.low)
    expect(DARK_CHROMA_REDUCTION.chosen).toBeLessThanOrEqual(DARK_CHROMA_REDUCTION.high)
  })

  it('keeps the paper budget tighter than the panel budget', () => {
    expect(CHROMA_BUDGET.paper).toBeLessThan(CHROMA_BUDGET.panel)
    expect(CHROMA_BUDGET.paperTintMinimum).toBeLessThan(CHROMA_BUDGET.paper)
  })
})
