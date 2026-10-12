import { describe, expect, it } from 'vitest'
import { buildPalettes } from '../colour/palette.ts'
import { runThemeDoctor } from '../doctor/run.ts'
import { validateThemeDocument } from '../schema/validate.ts'
import { generateTheme } from '../generate.ts'
import {
  BUILTIN_THEME_IDS,
  OFFERED_THEME_IDS,
  SUPERSEDED_THEMES,
  type BuiltinThemeId,
} from '../schema/theme-document.ts'
import { press } from './press.ts'
import {
  BUILTIN_THEMES,
  builtinTheme,
  DEFAULT_THEME,
  OFFERED_THEMES,
  recommendedLayout,
  successorOf,
  supersededBy,
} from './themes.ts'

describe('the built-in themes', () => {
  it('resolves every id a document may name, offered or superseded', () => {
    expect(Object.keys(BUILTIN_THEMES).toSorted()).toEqual([...BUILTIN_THEME_IDS].toSorted())
  })

  it('offers Instrument, Calm, Editorial, Grid and Atelier, in that order', () => {
    expect(Object.keys(OFFERED_THEMES)).toEqual([...OFFERED_THEME_IDS])
    expect(OFFERED_THEME_IDS).toEqual(['instrument', 'calm', 'editorial', 'grid', 'atelier'])
  })

  it.each(OFFERED_THEME_IDS)('gives %s a document that carries its own id', (id) => {
    expect(OFFERED_THEMES[id].id).toBe(id)
  })

  it('defaults to Instrument, as ADR-028 says', () => {
    expect(DEFAULT_THEME.id).toBe('instrument')
  })

  it('looks a theme up by id', () => {
    expect(builtinTheme('grid')).toBe(BUILTIN_THEMES.grid)
  })

  it.each(BUILTIN_THEME_IDS)('validates %s against the schema', (id: BuiltinThemeId) => {
    expect(validateThemeDocument(BUILTIN_THEMES[id]).valid).toBe(true)
  })

  it.each(BUILTIN_THEME_IDS.filter((id) => id !== 'grid'))(
    'passes the doctor with no warnings: %s',
    (id: BuiltinThemeId) => {
      const report = runThemeDoctor(BUILTIN_THEMES[id])
      expect(report.warnings).toEqual([])
      expect(report.enforcedRulesHold).toBe(true)
    },
  )

  /**
   * Grid reproduces lockstay's portal, and in three places lockstay is
   * further from the colour rules than a theme Quill designs itself would be:
   * its dark card is 1.5 above the panel beneath it rather than 3, and its
   * current-item wash is more saturated than the area budget, more so in
   * dark. The doctor advises; the owner chose fidelity (11 October 2026), so
   * these are the accepted warnings and nothing else may join them. Text
   * contrast still holds everywhere.
   */
  it('passes the doctor on Grid with only lockstay’s accepted departures', () => {
    const report = runThemeDoctor(BUILTIN_THEMES.grid)
    expect(report.warnings.map((warning) => warning.id).toSorted()).toEqual([
      'bands/surface-separation',
      // The dark wash is a touch over the wash budget; it no longer also
      // counts against dark re-derivation, which leaves washes to their budget.
      'chroma/area-budget',
    ])
    expect(report.enforcedRulesHold).toBe(true)
  })
})

/**
 * AGENTS.md rule 17. Press was offered, so organisations saved it: their
 * settings carry the whole document, and a fork carries `base: 'press'`. Both
 * must keep loading after Press stopped being offered.
 */
describe('a superseded theme', () => {
  it('names its successor, which is offered', () => {
    expect(SUPERSEDED_THEMES).toEqual({ press: 'editorial' })
    expect(successorOf('press')).toBe('editorial')
    expect(successorOf('grid')).toBe('grid')
    expect(supersededBy('editorial')).toEqual(['press'])
    expect(supersededBy('calm')).toEqual([])
  })

  it('resolves its id to the successor’s document', () => {
    expect(BUILTIN_THEMES.press).toBe(OFFERED_THEMES.editorial)
    expect(builtinTheme('press').name).toBe('Editorial')
  })

  it('still loads the Press document an organisation saved, exactly as saved', () => {
    const saved: unknown = structuredClone(press)
    const result = validateThemeDocument(saved)
    expect(result.valid).toBe(true)
    expect(result.valid && result.document).toEqual(press)

    const generated = generateTheme(press)
    expect(generated.light['--font-reading']).toContain('Newsreader')
    expect(generated.light['--text-reading']).toBe('1.0625rem')
    expect(generated.light['--layout-content']).toBe('38rem')
    expect(generated.report.enforcedRulesHold).toBe(true)
  })

  it('still loads a fork whose base is Press', () => {
    const fork: unknown = {
      ...structuredClone(press),
      id: 'northwind',
      name: 'Northwind',
      base: 'press',
    }
    expect(validateThemeDocument(fork).valid).toBe(true)
  })
})

describe('the seeds of each theme', () => {
  it('keeps the frozen Press document: warm paper, oxblood, sidenotes, double rules', () => {
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

  it('gives Grid lockstay’s cool page, quiet teal, Figtree throughout and plain space', () => {
    const { grid } = BUILTIN_THEMES
    expect(grid.seeds.tone.hue).toBe(215)
    expect(grid.seeds.accent).toEqual({ hue: 190, chroma: 0.085, lightness: 47, darkLightness: 78 })
    expect(grid.variants.rules).toBe('plain')
    for (const role of ['display', 'reading', 'interface'] as const) {
      expect(grid.type[role]).toEqual({ source: 'curated', id: 'figtree' })
    }
    expect(grid.type.scale).toMatchObject({ size: 15, leading: 1.6, measure: 46 })
    expect(grid.type.scale?.h1).toEqual({ size: 34, lineHeight: 40, weight: 700, tracking: -0.02 })
    expect(grid.type.links).toMatchObject({ text: 'accent', underline: 'current' })
    expect(grid.variants.align).toBe('start')
    expect(grid.shape).toEqual({ radiusStep: 3, density: 'comfortable' })
  })

  it('lands Grid on lockstay’s register, with a firmer hairline', () => {
    const { light, dark } = buildPalettes(BUILTIN_THEMES.grid)
    expect(light.colours.paper.lightness).toBe(97.2)
    expect(light.colours.raised.lightness).toBe(100)
    expect(light.colours.border.lightness).toBe(90)
    expect(light.colours.ink.lightness).toBe(22)
    expect(light.colours.body.lightness).toBe(38)
    expect(light.colours.muted.lightness).toBe(52)
    expect(dark.colours.paper.lightness).toBe(19)
    expect(dark.colours.raised.lightness).toBe(23)
    expect(dark.colours.border.lightness).toBe(29)
    expect(dark.colours.ink.lightness).toBe(95)
    expect(dark.colours.accent.lightness).toBe(78)
    expect(dark.colours.accentInk.lightness).toBe(84)
  })

  it('gives Calm Inter throughout, a near-grey cool tone and an indigo accent', () => {
    const { calm } = BUILTIN_THEMES
    for (const role of ['display', 'reading', 'interface'] as const) {
      expect(calm.type[role]).toEqual({ source: 'curated', id: 'inter' })
    }
    expect(calm.type.mono).toEqual({ source: 'curated', id: 'jetbrains-mono' })
    expect(calm.type.scale).toMatchObject({ size: 16, leading: 1.625, measure: 42 })
    expect(calm.seeds.accent.hue).toBe(262)
    expect(calm.variants.rules).toBe('plain')
  })

  it('lands Calm on white cards over a near-white page, and a charcoal that steps up', () => {
    const { light, dark } = buildPalettes(BUILTIN_THEMES.calm)
    expect(light.colours.paper.lightness).toBe(98.5)
    expect(light.colours.raised.lightness).toBe(100)
    expect(light.colours.body.lightness).toBe(40)
    expect(light.colours.accent.lightness).toBe(53)
    expect(dark.colours.paper.lightness).toBe(17)
    expect(dark.colours.raised.lightness).toBeGreaterThan(dark.colours.surface.lightness)
    expect(dark.colours.ink.lightness).toBe(95)
  })

  it('gives Editorial a serif column over Inter chrome, on warm paper', () => {
    const { editorial } = BUILTIN_THEMES
    expect(editorial.type.display).toEqual({ source: 'curated', id: 'source-serif-4' })
    expect(editorial.type.reading).toEqual({ source: 'curated', id: 'source-serif-4' })
    expect(editorial.type.interface).toEqual({ source: 'curated', id: 'inter' })
    expect(editorial.type.scale).toMatchObject({ size: 18.5, leading: 1.68, measure: 40 })
    expect(editorial.seeds.tone.hue).toBe(70)
    expect(editorial.seeds.accent.hue).toBe(35)
    expect(editorial.variants.comments).toBe('sidenotes')
  })

  it('sets Editorial’s body strong, as in print, and keeps its dark ink off white', () => {
    const { light, dark } = buildPalettes(BUILTIN_THEMES.editorial)
    expect(light.colours.body.lightness).toBe(30)
    expect(dark.colours.ink.lightness).toBe(93)
    expect(dark.colours.paper.lightness).toBeGreaterThan(15)
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
