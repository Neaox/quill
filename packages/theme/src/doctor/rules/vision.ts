import { buildPalettes, type Palette, type ThemePalettes } from '../../colour/palette.ts'
import type { ThemeDocument } from '../../schema/theme-document.ts'
import { pairSeparation, worstSeparation, type SeparationResult } from '../cvd.ts'
import { adjusted, pass, round, warn, type Rule, type RuleOutcome } from '../rule.ts'

/** Section 8: the status set must stay separable under simulated CVD. */
export const STATUS_SEPARATION_FLOOR = 20

/**
 * Section 8 gives no number for the accent, so this package commits to one:
 * far enough apart that an accent link is not read as muted metadata.
 */
export const ACCENT_SEPARATION_FLOOR = 10

/**
 * What the seeds alone would have produced. A shortfall the tenant did not
 * cause is advice, not a warning: sections 3 and 5 pin the status set to one
 * lightness and three narrow hue bands, which caps how far apart a red and a
 * green can be made under deuteranopia. The rules say as much themselves —
 * where it fails, the fix is a shape or a label, never a fourth colour.
 */
const withoutOverrides = (theme: ThemeDocument): ThemePalettes => {
  const { statusOverrides: _statusOverrides, ...seeds } = theme.seeds
  const { overrides: _overrides, ...rest } = theme
  return buildPalettes({ ...rest, seeds })
}

const weakest = (results: readonly [SeparationResult, SeparationResult]): SeparationResult =>
  results[0].deltaE <= results[1].deltaE ? results[0] : results[1]

const verdict = (
  measured: SeparationResult,
  reference: SeparationResult,
  floor: number,
  advice: string,
): RuleOutcome => {
  if (measured.deltaE >= floor) {
    return pass(
      `the closest pair stays ${round(measured.deltaE, 1)} apart in OKLab under simulated colour vision deficiency`,
    )
  }
  const shortfall = `${measured.pair.join(' and ')} are only ${round(
    measured.deltaE,
    1,
  )} apart in OKLab under ${measured.deficiency}`
  return measured.deltaE < reference.deltaE - 1
    ? warn(`${shortfall}; the seeds alone would have given ${round(reference.deltaE, 1)}`)
    : adjusted(`${shortfall}. ${advice}`)
}

const statusSeparation = (palette: Palette): SeparationResult =>
  worstSeparation(
    ['success', palette.colours.success],
    ['warning', palette.colours.warning],
    ['danger', palette.colours.danger],
  )

/**
 * Info takes the accent (section 5), so it is graded by the accent's own rule
 * rather than counted twice here.
 */
export const statusSeparationRule: Rule = {
  id: 'cvd/status-separation',
  section: 8,
  title: 'Status colours stay separable under protan, deutan and tritan vision',
  evaluate: (theme, palettes) =>
    verdict(
      weakest([statusSeparation(palettes.light), statusSeparation(palettes.dark)]),
      statusSeparation(withoutOverrides(theme).light),
      STATUS_SEPARATION_FLOOR,
      'Status must carry a shape or a label as well as a colour, never a fourth colour.',
    ),
}

const accentAgainstMuted = (palettes: ThemePalettes): SeparationResult =>
  weakest([
    pairSeparation(
      'accent',
      palettes.light.colours.accent,
      'muted text',
      palettes.light.colours.muted,
    ),
    pairSeparation(
      'accent',
      palettes.dark.colours.accent,
      'muted text',
      palettes.dark.colours.muted,
    ),
  ])

export const accentSeparationRule: Rule = {
  id: 'cvd/accent-separation',
  section: 8,
  title: 'The accent stays separable from muted text under simulated CVD',
  evaluate: (theme, palettes) =>
    verdict(
      accentAgainstMuted(palettes),
      accentAgainstMuted(withoutOverrides(theme)),
      ACCENT_SEPARATION_FLOOR,
      'Links and controls must also carry an underline, a weight or a position, never colour alone.',
    ),
}
