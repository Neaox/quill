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
import { STATUS_NAMES } from '../../colour/status.ts'
import { adjusted, check, fromChecks, pass, round, warn, type Rule } from '../rule.ts'

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values)

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
    const agrees = distance <= ANALOGOUS_LIMIT || inBand(distance, COMPLEMENTARY_BAND)
    return agrees
      ? pass(
          `the tone sits ${round(distance, 1)} degrees from the accent, which reads as ${
            distance <= ANALOGOUS_LIMIT ? 'analogous' : 'complementary'
          }`,
        )
      : warn(
          `the tone sits ${round(distance, 1)} degrees from the accent, in the 60 to 150 range that reads as a mismatch`,
        )
  },
}

/** Section 5: the status set holds its hue bands and stays clear of the accent. */
export const statusHueRule: Rule = {
  id: 'hue/status-set',
  section: 5,
  title: 'Status hues hold their bands and keep clear of the accent',
  evaluate: (theme, palettes) => {
    const palette = palettes.light
    const bandChecks = STATUS_NAMES.map((name) => {
      const hue = palette.colours[name].hue
      const band = STATUS_HUE_BANDS[name]
      return check(
        `${name} is at H ${round(hue, 1)}, outside H ${band.low} to ${band.high}`,
        hue >= band.low - 1e-9 && hue <= band.high + 1e-9,
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
}

/** Section 5: the status set shares lightness and chroma and differs only in hue. */
export const statusMatchRule: Rule = {
  id: 'hue/status-matched',
  section: 5,
  title: 'Status colours share lightness and chroma',
  evaluate: (_theme, palettes) =>
    fromChecks(
      [palettes.light, palettes.dark].flatMap((palette) => {
        const colours = STATUS_NAMES.map((name) => palette.colours[name])
        const lightnesses = colours.map((colour) => colour.lightness)
        const chromas = colours.map((colour) => colour.chroma)
        return [
          check(
            `${palette.scheme} status lightness spreads ${round(spread(lightnesses), 1)}, over ${STATUS_MATCH_TOLERANCE.lightness}`,
            spread(lightnesses) <= STATUS_MATCH_TOLERANCE.lightness + 1e-9,
          ),
          check(
            `${palette.scheme} status chroma spreads ${round(spread(chromas), 4)}, over ${STATUS_MATCH_TOLERANCE.chroma}`,
            spread(chromas) <= STATUS_MATCH_TOLERANCE.chroma + 1e-9,
          ),
        ]
      }),
      'the status set differs in hue alone',
    ),
}
