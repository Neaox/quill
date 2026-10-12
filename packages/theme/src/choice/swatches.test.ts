import { describe, expect, it } from 'vitest'

import { OFFERED_THEMES } from '../builtin/themes.ts'
import { generateTheme } from '../generate.ts'
import type { ThemeDocument } from '../schema/theme-document.ts'
import { ACCENT_SWATCHES, choiceOfSwatch, swatchMatching } from './swatches.ts'
import { withAccent } from './accent-choice.ts'

/**
 * A warning the built-in's own structure carries — Grid's dark raised step —
 * is not the swatch's to answer for, so a swatch passes when it adds none to
 * the built-in as `withAccent` leaves it.
 */
const warningsOn = (theme: ThemeDocument): readonly string[] =>
  generateTheme(theme)
    .report.warnings.map((warning) => warning.id)
    // Whether the tone agrees with a new accent is the tone's choice.
    .filter((id) => id !== 'hue/neutral-accent-agreement')

describe('ACCENT_SWATCHES', () => {
  it('names each swatch once', () => {
    const names = ACCENT_SWATCHES.map((swatch) => swatch.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThanOrEqual(12)
  })

  describe.each(Object.values(OFFERED_THEMES))('on a fork of $name', (base) => {
    const before = warningsOn(withAccent(base, base.seeds.accent))

    it.each(ACCENT_SWATCHES)('$name passes the doctor in light and dark', (swatch) => {
      const theme = withAccent(base, choiceOfSwatch(swatch))
      expect(warningsOn(theme).filter((id) => !before.includes(id))).toEqual([])
    })
  })

  it.each(ACCENT_SWATCHES)('$name on a fork of Calm leaves no warning at all', (swatch) => {
    expect(warningsOn(withAccent(OFFERED_THEMES.calm, choiceOfSwatch(swatch)))).toEqual([])
  })
})

describe('swatchMatching', () => {
  const [swatch] = ACCENT_SWATCHES

  it('finds the swatch a choice is', () => {
    expect(swatchMatching(choiceOfSwatch(swatch))).toBe(swatch)
  })

  it('finds none for a custom hue or chroma', () => {
    expect(swatchMatching({ hue: swatch.hue + 3, chroma: swatch.chroma })).toBeUndefined()
    expect(swatchMatching({ hue: swatch.hue, chroma: swatch.chroma + 0.01 })).toBeUndefined()
  })

  it('treats a brand colour on a swatch hue as the brand’s own', () => {
    expect(swatchMatching({ ...choiceOfSwatch(swatch), lightness: 40 })).toBeUndefined()
    expect(swatchMatching({ ...choiceOfSwatch(swatch), darkLightness: 72 })).toBeUndefined()
  })
})
