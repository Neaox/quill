import { zip } from 'remeda'
import { DARK_CHROMA_REDUCTION } from '../../colour/bands.ts'
import { hueDistance } from '../../colour/hue.ts'
import { PALETTE_ROLES, type Palette } from '../../colour/palette.ts'
import { boundaryPairs, describe, holds, syntaxPairs, textPairs, type Pair } from '../pairs.ts'
import { adjusted, check, fromChecks, pass, round, warn, type Rule } from '../rule.ts'

const HUE_TOLERANCE = 0.5

/**
 * Tints are a mix of a seed colour into the paper, so their hue is a result
 * rather than a seed and legitimately differs between a light and a dark
 * ground. Their chroma is still held to the rule.
 */
const MIXED_ROLES = new Set<string>([
  'accentSubtle',
  'selection',
  'successSubtle',
  'warningSubtle',
  'dangerSubtle',
])

/** Section 7: same hue seeds, dark bands, chroma reduced. Never an inversion. */
export const darkRederivationRule: Rule = {
  id: 'dark/rederivation',
  section: 7,
  title: 'Dark mode keeps the hues and reduces the chroma',
  evaluate: (_theme, palettes) => {
    const failures = PALETTE_ROLES.flatMap((role) => {
      const light = palettes.light.colours[role]
      const dark = palettes.dark.colours[role]
      const driftedHue =
        !MIXED_ROLES.has(role) &&
        light.chroma > 0 &&
        dark.chroma > 0 &&
        hueDistance(light.hue, dark.hue) > HUE_TOLERANCE
      const gainedChroma = dark.chroma > light.chroma + 1e-9
      return [
        ...(driftedHue ? [`${role} changed hue between schemes`] : []),
        ...(gainedChroma
          ? [
              `${role} gained chroma in dark mode (${round(light.chroma, 4)} to ${round(dark.chroma, 4)})`,
            ]
          : []),
      ]
    })
    if (failures.length > 0) return warn(failures.join('; '))

    const lightAccent = palettes.light.colours.accent.chroma
    const darkAccent = palettes.dark.colours.accent.chroma
    const reduction = lightAccent === 0 ? 0 : 1 - darkAccent / lightAccent
    const detail = `the dark accent carries ${round(reduction * 100, 1)} percent less chroma than the light one`
    return reduction >= DARK_CHROMA_REDUCTION.low - 1e-9 &&
      reduction <= DARK_CHROMA_REDUCTION.high + 1e-9
      ? pass(detail)
      : adjusted(`${detail}, outside the 20 to 30 percent the rules ask for`)
  },
}

/** Section 7: elevation is lightness, not shadow, once the paper is dark. */
export const darkElevationRule: Rule = {
  id: 'dark/elevation',
  section: 7,
  title: 'Dark elevation rises in lightness rather than in shadow',
  evaluate: (_theme, palettes) => {
    const { paper, surface, raised } = palettes.dark.colours
    return fromChecks(
      [
        check(
          `dark surface L ${round(surface.lightness, 1)} does not rise above paper L ${round(paper.lightness, 1)}`,
          surface.lightness > paper.lightness,
        ),
        check(
          `dark raised L ${round(raised.lightness, 1)} does not rise above surface L ${round(surface.lightness, 1)}`,
          raised.lightness > surface.lightness,
        ),
      ],
      'each dark elevation step is lighter than the one below it',
    )
  },
}

const everyPair = (palette: Palette): readonly Pair[] => [
  ...textPairs(palette),
  ...boundaryPairs(palette),
  ...syntaxPairs(palette),
]

/** Section 7: passing in light mode says nothing about dark. */
export const darkRecheckRule: Rule = {
  id: 'dark/contrast-recheck',
  section: 7,
  title: 'Every pair that passes in light also passes in dark',
  evaluate: (_theme, palettes) => {
    const pairs = zip(everyPair(palettes.light), everyPair(palettes.dark))
    const regressions = pairs
      .filter(([lightPair, darkPair]) => holds(lightPair) && !holds(darkPair))
      .map(([, darkPair]) => darkPair)
    return regressions.length === 0
      ? pass(`all ${pairs.length} pairs were re-checked in dark mode and hold`)
      : warn(regressions.map(describe).join('; '))
  },
}
