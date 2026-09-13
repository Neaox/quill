import { describe, expect, it } from 'vitest'
import { describeAdjustment, type Adjustment } from './adjustment.ts'

describe('describeAdjustment', () => {
  it('names the adjustment the way the theme editor reads it out', () => {
    const adjustment: Adjustment = {
      role: 'accent',
      property: 'lightness',
      reason: 'contrast',
      from: 62,
      to: 48,
    }
    expect(describeAdjustment(adjustment)).toBe('accent lightness 62 to 48 (contrast)')
  })

  it('keeps chroma to four places and hue to one', () => {
    expect(
      describeAdjustment({
        role: 'warning',
        property: 'chroma',
        reason: 'gamut',
        from: 0.134_567_8,
        to: 0.098_432_1,
      }),
    ).toBe('warning chroma 0.1346 to 0.0984 (gamut)')
    expect(
      describeAdjustment({
        role: 'danger',
        property: 'hue',
        reason: 'separation',
        from: 27.54,
        to: 30,
      }),
    ).toBe('danger hue 27.5 to 30 (separation)')
  })
})
