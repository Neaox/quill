import { assert, double, property, record } from 'fast-check'
import { describe, expect, it } from 'vitest'
import { instrument } from './builtin/instrument.ts'
import { inBand, LIGHTNESS_BANDS } from './colour/bands.ts'
import { buildPalettes, PALETTE_ROLES, type Palette } from './colour/palette.ts'
import { toCss } from './css.ts'
import { boundaryPairs, holds, syntaxPairs, textPairs, type Pair } from './doctor/pairs.ts'
import { generateTheme } from './generate.ts'
import type { ThemeDocument } from './schema/theme-document.ts'
import { SYNTAX_FAMILIES } from './tokens.ts'

/**
 * Any seed a tenant could choose. Nothing else in the document affects the
 * palette, so the rest stays at the built-in's values.
 */
const seededTheme = record({
  toneHue: double({ min: 0, max: 359.999, noNaN: true }),
  toneChroma: double({ min: 0, max: 0.04, noNaN: true }),
  accentHue: double({ min: 0, max: 359.999, noNaN: true }),
  accentChroma: double({ min: 0, max: 0.37, noNaN: true }),
  accentLightness: double({ min: 0, max: 100, noNaN: true }),
}).map((seeds): ThemeDocument => ({
  ...instrument,
  seeds: {
    tone: { hue: seeds.toneHue, chroma: seeds.toneChroma },
    accent: {
      hue: seeds.accentHue,
      chroma: seeds.accentChroma,
      lightness: seeds.accentLightness,
    },
  },
}))

const everyPair = (palette: Palette): readonly Pair[] => [
  ...textPairs(palette),
  ...boundaryPairs(palette),
  ...syntaxPairs(palette),
]

const BANDED = ['paper', 'surface', 'raised', 'border', 'muted', 'ink', 'accent'] as const
const SCHEMES = ['light', 'dark'] as const

describe('generated palettes, for any seeds', () => {
  it('clear the contrast floors in both schemes after adjustment', () => {
    assert(
      property(seededTheme, (theme) => {
        const { light, dark } = buildPalettes(theme)
        const failures = [...everyPair(light), ...everyPair(dark)].filter((pair) => !holds(pair))
        expect(failures.map((pair) => pair.label)).toEqual([])
      }),
      { numRuns: 100 },
    )
  })

  it('hold the lightness bands for every banded role', () => {
    assert(
      property(seededTheme, (theme) => {
        const palettes = buildPalettes(theme)
        const outside = SCHEMES.flatMap((scheme) =>
          BANDED.filter(
            (role) =>
              !inBand(palettes[scheme].colours[role].lightness, LIGHTNESS_BANDS[role][scheme]),
          ).map((role) => `${scheme} ${role}`),
        )
        expect(outside).toEqual([])
      }),
      { numRuns: 100 },
    )
  })

  it('never give the dark scheme more chroma than the light one', () => {
    assert(
      property(seededTheme, (theme) => {
        const { light, dark } = buildPalettes(theme)
        const gained = [
          ...PALETTE_ROLES.filter(
            (role) => dark.colours[role].chroma > light.colours[role].chroma + 1e-9,
          ),
          ...SYNTAX_FAMILIES.filter(
            (family) => dark.syntax[family].chroma > light.syntax[family].chroma + 1e-9,
          ),
        ]
        expect(gained).toEqual([])
      }),
      { numRuns: 100 },
    )
  })

  it('emit a real colour for every token', () => {
    assert(
      property(seededTheme, (theme) => {
        const generated = generateTheme(theme)
        const values = [...Object.values(generated.light), ...Object.values(generated.dark)]
        expect(values.filter((value) => value.includes('NaN'))).toEqual([])
      }),
      { numRuns: 50 },
    )
  })
})

describe('toCss', () => {
  it('is idempotent: emitting the same generated theme twice gives the same text', () => {
    assert(
      property(seededTheme, (theme) => {
        const generated = generateTheme(theme)
        expect(toCss(generated)).toBe(toCss(generated))
        expect(toCss(generateTheme(theme))).toBe(toCss(generated))
      }),
      { numRuns: 50 },
    )
  })
})
