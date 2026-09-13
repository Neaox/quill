import { describe, expect, it } from 'vitest'
import { runThemeDoctor } from '../doctor/run.ts'
import { validateThemeDocument } from '../schema/validate.ts'
import { BUILTIN_THEME_IDS, type BuiltinThemeId } from '../schema/theme-document.ts'
import { BUILTIN_THEMES, builtinTheme, DEFAULT_THEME, recommendedLayout } from './themes.ts'

describe('the built-in themes', () => {
  it('ships exactly the three directions on the design canvas', () => {
    expect(Object.keys(BUILTIN_THEMES).toSorted()).toEqual([...BUILTIN_THEME_IDS].toSorted())
  })

  it('defaults to Instrument, as ADR-028 says', () => {
    expect(DEFAULT_THEME.id).toBe('instrument')
  })

  it('looks a theme up by id', () => {
    expect(builtinTheme('press')).toBe(BUILTIN_THEMES.press)
  })

  it.each(BUILTIN_THEME_IDS)('validates %s against the schema', (id: BuiltinThemeId) => {
    expect(validateThemeDocument(BUILTIN_THEMES[id]).valid).toBe(true)
  })

  it.each(BUILTIN_THEME_IDS)('passes the doctor with no warnings: %s', (id: BuiltinThemeId) => {
    const report = runThemeDoctor(BUILTIN_THEMES[id])
    expect(report.warnings).toEqual([])
    expect(report.enforcedRulesHold).toBe(true)
  })
})

describe('the seeds taken from the artboards', () => {
  it('gives Press warm paper, an oxblood accent, sidenotes and double rules', () => {
    const { press } = BUILTIN_THEMES
    expect(press.seeds.tone).toEqual({ hue: 85, chroma: 0.008 })
    expect(press.seeds.accent).toEqual({ hue: 25, chroma: 0.12, lightness: 42 })
    expect(press.variants.comments).toBe('sidenotes')
    expect(press.variants.rules).toBe('double')
    expect(press.type.reading).toEqual({ source: 'curated', id: 'newsreader' })
  })

  it('gives Instrument a cool neutral, a signal orange, a timeline and hairlines', () => {
    const { instrument } = BUILTIN_THEMES
    expect(instrument.seeds.tone).toEqual({ hue: 250, chroma: 0.008 })
    expect(instrument.seeds.accent).toEqual({ hue: 45, chroma: 0.2, lightness: 62 })
    expect(instrument.variants.history).toBe('timeline')
    expect(instrument.variants.header).toBe('readout')
    expect(instrument.variants.rules).toBe('hairline')
    expect(instrument.shape.density).toBe('compact')
  })

  it('gives Atelier a warm tone, a moss accent, coloured tabs and cards', () => {
    const { atelier } = BUILTIN_THEMES
    expect(atelier.seeds.tone).toEqual({ hue: 90, chroma: 0.012 })
    expect(atelier.seeds.accent).toEqual({ hue: 150, chroma: 0.1, lightness: 42 })
    expect(atelier.variants.navigation).toBe('tabs')
    expect(atelier.variants.rules).toBe('cards')
    expect(atelier.type.display).toEqual({ source: 'curated', id: 'instrument-serif' })
  })

  it('keeps the signal accent as a mark and derives a text-safe one', () => {
    const report = runThemeDoctor(BUILTIN_THEMES.instrument)
    const marks = report.adjustments.filter((entry) => entry.role === 'accent')
    expect(marks.some((entry) => entry.reason === 'band')).toBe(true)
  })

  /**
   * ADR-028's amendment moves the signature variants out of the theme and
   * calls them a layout, chosen per workspace; the theme keeps them as what it
   * *recommends*. This function is the one place that reads the one as the
   * other, which is what makes the rename a one-line change — so it is held to
   * that here, in the package the definition now lives in.
   */
  it('recommends each built-in theme’s own signature variants as a layout', () => {
    for (const theme of Object.values(BUILTIN_THEMES)) {
      expect(recommendedLayout(theme)).toEqual(theme.variants)
    }
  })
})
