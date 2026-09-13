import { describeAdjustment } from '../../colour/adjustment.ts'
import { isInGamut } from '../../colour/oklch.ts'
import { MAX_CHROMA_COMPENSATION, hueDistance } from '../../colour/hue.ts'
import type { Palette } from '../../colour/palette.ts'
import { adjusted, check, fromChecks, pass, round, warn, type Rule } from '../rule.ts'

const NEUTRAL_ROLES = [
  'paper',
  'surface',
  'raised',
  'border',
  'borderStrong',
  'muted',
  'ink',
  'codeBackground',
  'placeholder',
] as const

const HUE_TOLERANCE = 0.5

/** Section 2: lightening a colour must not turn a teal into a mint. */
export const rampHueRule: Rule = {
  id: 'uniformity/ramp-hue-constant',
  section: 2,
  title: 'The neutral ramp keeps one hue at every step',
  evaluate: (theme, palettes) =>
    fromChecks(
      [palettes.light, palettes.dark].flatMap((palette: Palette) =>
        NEUTRAL_ROLES.map((role) => {
          const distance = hueDistance(palette.colours[role].hue, theme.seeds.tone.hue)
          return check(
            `${palette.scheme} ${role} drifted ${round(distance, 1)} degrees from the tone hue`,
            palette.colours[role].chroma === 0 || distance <= HUE_TOLERANCE,
          )
        }),
      ),
      'every neutral step holds the tone hue',
    ),
}

/** Section 2: gamut-map, never clip. */
export const gamutRule: Rule = {
  id: 'uniformity/gamut-mapped',
  section: 2,
  title: 'Every colour is inside sRGB, reached by reducing chroma',
  evaluate: (_theme, palettes) => {
    const both = [palettes.light, palettes.dark]
    const outside = both.flatMap((palette) =>
      [...Object.entries(palette.colours), ...Object.entries(palette.syntax)]
        .filter(([, colour]) => !isInGamut(colour))
        .map(([role]) => `${palette.scheme} ${role} is outside sRGB`),
    )
    if (outside.length > 0) return warn(outside.join('; '))
    const reductions = both.flatMap((palette) =>
      palette.adjustments.filter((entry) => entry.reason === 'gamut'),
    )
    return reductions.length === 0
      ? pass('every colour was already inside sRGB')
      : adjusted(`chroma reduced to fit sRGB: ${reductions.map(describeAdjustment).join(', ')}`)
  },
}

/** Section 2: a hue-dependent chroma adjustment of up to 15 percent. */
export const chromaCompensationRule: Rule = {
  id: 'uniformity/chroma-compensation',
  section: 2,
  title: 'Matched hues carry a hue-dependent chroma correction within 15 percent',
  evaluate: (_theme, palettes) => {
    const applied = [palettes.light, palettes.dark].flatMap((palette) =>
      palette.adjustments.filter((entry) => entry.reason === 'compensation'),
    )
    const excessive = applied.filter(
      (entry) => Math.abs(entry.to - entry.from) > entry.from * MAX_CHROMA_COMPENSATION + 1e-9,
    )
    if (excessive.length > 0) {
      return warn(
        excessive.map((entry) => `${entry.role} was corrected beyond 15 percent`).join('; '),
      )
    }
    return applied.length === 0
      ? pass('no hue needed a chroma correction')
      : adjusted(
          `chroma corrected so the status hues feel equal: ${applied
            .map((entry) => `${entry.role} ${round(entry.from, 4)} to ${round(entry.to, 4)}`)
            .join(', ')}`,
        )
  },
}
