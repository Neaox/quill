import {
  ANALOGOUS_LIMIT,
  COMPLEMENTARY_BAND,
  MIN_ACCENT_STATUS_SEPARATION,
  NEUTRAL_TINT_VISIBLE_CHROMA,
  STATUS_HUE_BANDS,
  STATUS_MATCH_TOLERANCE,
  inBand,
} from '../../colour/bands.ts'
import { hueDistance } from '../../colour/hue.ts'
import type { Palette } from '../../colour/palette.ts'
import { STATUS_NAMES, type StatusName } from '../../colour/status.ts'
import type { ThemeDocument } from '../../schema/theme-document.ts'
import { adjustmentEvidence, swatchEvidence } from '../evidence.ts'
import { adjusted, check, fromChecks, pass, round, warn, type Rule } from '../rule.ts'

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values)

/** True when the tone is too grey to clash, or sits analogous or complementary to the accent. */
const toneAgreesWithAccent = (theme: ThemeDocument): boolean => {
  const { tone, accent } = theme.seeds
  const distance = hueDistance(tone.hue, accent.hue)
  return (
    tone.chroma <= NEUTRAL_TINT_VISIBLE_CHROMA ||
    distance <= ANALOGOUS_LIMIT ||
    inBand(distance, COMPLEMENTARY_BAND)
  )
}

/** Section 5: neutrals and accent must agree. */
export const neutralAgreementRule: Rule = {
  id: 'hue/neutral-accent-agreement',
  section: 5,
  title: 'A tinted neutral is analogous to, or complementary with, the accent',
  evaluate: (theme) => {
    const { tone, accent } = theme.seeds
    if (tone.chroma <= NEUTRAL_TINT_VISIBLE_CHROMA) {
      return pass(
        `the tone is effectively grey at C ${round(tone.chroma, 4)}, so any accent hue works`,
      )
    }
    const distance = hueDistance(tone.hue, accent.hue)
    return toneAgreesWithAccent(theme)
      ? pass(
          `the tone sits ${round(distance, 1)} degrees from the accent, which reads as ${
            distance <= ANALOGOUS_LIMIT ? 'analogous' : 'complementary'
          }`,
        )
      : warn(
          `the tone sits ${round(distance, 1)} degrees from the accent, in the 60 to 150 range that reads as a mismatch`,
        )
  },
  evidence: (theme, palettes) =>
    swatchEvidence(palettes, ['surface', 'accent'], () => toneAgreesWithAccent(theme)),
}

const holdsStatusBand = (palette: Palette, name: StatusName): boolean => {
  const hue = palette.colours[name].hue
  const band = STATUS_HUE_BANDS[name]
  return hue >= band.low - 1e-9 && hue <= band.high + 1e-9
}

/** Section 5: the status set holds its hue bands and stays clear of the accent. */
export const statusHueRule: Rule = {
  id: 'hue/status-set',
  section: 5,
  title: 'Status hues hold their bands and keep clear of the accent',
  evaluate: (theme, palettes) => {
    const palette = palettes.light
    const bandChecks = STATUS_NAMES.map((name) => {
      const band = STATUS_HUE_BANDS[name]
      return check(
        `${name} is at H ${round(palette.colours[name].hue, 1)}, outside H ${band.low} to ${band.high}`,
        holdsStatusBand(palette, name),
      )
    })
    const outOfBand = bandChecks.filter((entry) => !entry.ok)
    if (outOfBand.length > 0) return warn(outOfBand.map((entry) => entry.label).join('; '))

    const shifts = palette.adjustments.filter((entry) => entry.reason === 'separation')
    const distances = STATUS_NAMES.map((name) => ({
      name,
      distance: hueDistance(palette.colours[name].hue, theme.seeds.accent.hue),
    }))
    const tight = distances.filter((entry) => entry.distance < MIN_ACCENT_STATUS_SEPARATION)
    if (tight.length === 0) {
      return pass('every status hue is at least 40 degrees from the accent')
    }
    return adjusted(
      `${shifts
        .map(
          (entry) =>
            `${entry.role} shifted from H ${round(entry.from, 1)} to H ${round(entry.to, 1)}`,
        )
        .join(', ')}; ${tight
        .map(
          (entry) =>
            `${entry.name} is still ${round(entry.distance, 1)} degrees from the accent because its band allows no more`,
        )
        .join(', ')}`,
    )
  },
  evidence: (_theme, palettes) => [
    ...adjustmentEvidence(palettes, ['separation']),
    ...swatchEvidence(palettes, STATUS_NAMES, holdsStatusBand),
  ],
}

const spreadsOf = (palette: Palette): { lightness: number; chroma: number } => {
  const colours = STATUS_NAMES.map((name) => palette.colours[name])
  return {
    lightness: spread(colours.map((colour) => colour.lightness)),
    chroma: spread(colours.map((colour) => colour.chroma)),
  }
}

const statusMatches = (palette: Palette): boolean => {
  const spreads = spreadsOf(palette)
  return (
    spreads.lightness <= STATUS_MATCH_TOLERANCE.lightness + 1e-9 &&
    spreads.chroma <= STATUS_MATCH_TOLERANCE.chroma + 1e-9
  )
}

/** Section 5: the status set shares lightness and chroma and differs only in hue. */
export const statusMatchRule: Rule = {
  id: 'hue/status-matched',
  section: 5,
  title: 'Status colours share lightness and chroma',
  evaluate: (_theme, palettes) =>
    fromChecks(
      [palettes.light, palettes.dark].flatMap((palette) => {
        const spreads = spreadsOf(palette)
        return [
          check(
            `${palette.scheme} status lightness spreads ${round(spreads.lightness, 1)}, over ${STATUS_MATCH_TOLERANCE.lightness}`,
            spreads.lightness <= STATUS_MATCH_TOLERANCE.lightness + 1e-9,
          ),
          check(
            `${palette.scheme} status chroma spreads ${round(spreads.chroma, 4)}, over ${STATUS_MATCH_TOLERANCE.chroma}`,
            spreads.chroma <= STATUS_MATCH_TOLERANCE.chroma + 1e-9,
          ),
        ]
      }),
      'the status set differs in hue alone',
    ),
  evidence: (_theme, palettes) =>
    swatchEvidence(palettes, STATUS_NAMES, (palette) => statusMatches(palette)),
}
