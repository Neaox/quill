import { describe, expect, it } from 'vitest'

import { instrument } from '../builtin/instrument.ts'
import { describeColour, describeGreys } from './describe.ts'
import { ACCENT_SWATCHES, choiceOfSwatch } from './swatches.ts'

describe('describeColour', () => {
  it('names a swatch by its name', () => {
    const [swatch] = ACCENT_SWATCHES
    expect(describeColour(choiceOfSwatch(swatch))).toBe(swatch.name)
  })

  it('names any other colour by its strength and family', () => {
    expect(describeColour({ hue: 184, chroma: 0.13, lightness: 48 })).toBe('Balanced teal')
  })
})

describe('describeGreys', () => {
  it('names the temperature and the tint', () => {
    const seeds = { ...instrument.seeds, tone: { hue: 250, chroma: 0.012 } }
    expect(describeGreys(seeds)).toBe('Cool, tinted')
  })

  it('says custom for a fine-tuned tone', () => {
    const seeds = { ...instrument.seeds, tone: { hue: 120, chroma: 0.03 } }
    expect(describeGreys(seeds)).toBe('Custom hue, custom tint')
  })
})
