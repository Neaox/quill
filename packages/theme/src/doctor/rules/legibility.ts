import { LIGHTNESS_BANDS, inBand } from '../../colour/bands.ts'
import type { Palette } from '../../colour/palette.ts'
import { bestTextOn } from '../../contrast/best-text-on.ts'
import { CONTRAST_FLOORS, DECORATIVE_LC_BAND } from '../../contrast/floors.ts'
import { contrastEvidence, swatchEvidence, type ContrastTarget } from '../evidence.ts'
import {
  boundaryPairs,
  describe,
  holds,
  lcOf,
  ratioOf,
  syntaxPairs,
  textPairs,
  type Pair,
} from '../pairs.ts'
import { check, fromChecks, pass, round, warn, type Rule } from '../rule.ts'

const readingPairs = (palette: Palette): readonly Pair[] => [
  ...textPairs(palette),
  ...syntaxPairs(palette),
]

/** Section 1: the measured, non-negotiable floors. */
export const textContrastRule: Rule = {
  id: 'legibility/text-contrast',
  section: 1,
  title: 'Text contrast meets WCAG 2.2 AA and the APCA floor',
  evaluate: (_theme, palettes) => {
    const failures = [palettes.light, palettes.dark]
      .flatMap(readingPairs)
      .filter((pair) => !holds(pair))
    return failures.length === 0
      ? pass('every text pair clears its AA ratio and APCA floor in both schemes')
      : warn(failures.map(describe).join('; '))
  },
  evidence: (_theme, palettes) => contrastEvidence(palettes, readingPairs),
}

export const uiBoundaryRule: Rule = {
  id: 'legibility/ui-boundaries',
  section: 1,
  title: 'Focus rings and strong borders clear 3:1 and Lc 45',
  evaluate: (_theme, palettes) =>
    fromChecks(
      [...boundaryPairs(palettes.light), ...boundaryPairs(palettes.dark)].map((pair) =>
        check(describe(pair), holds(pair)),
      ),
      'every boundary clears 3:1 and Lc 45 against the surfaces it appears on',
    ),
  evidence: (_theme, palettes) => contrastEvidence(palettes, boundaryPairs),
}

const placeholderPair = (palette: Palette): Pair => ({
  label: 'placeholder on paper',
  foreground: palette.colours.placeholder,
  background: palette.colours.paper,
  floor: CONTRAST_FLOORS.nonText,
})

const DECORATIVE_TARGET: ContrastTarget = {
  lc: DECORATIVE_LC_BAND.low,
  lcAtMost: DECORATIVE_LC_BAND.high,
}

export const decorativeTextRule: Rule = {
  id: 'legibility/decorative-text',
  section: 1,
  title: 'Placeholder text stays inside the decorative band',
  evaluate: (_theme, palettes) =>
    fromChecks(
      [palettes.light, palettes.dark].map((palette) => {
        const lc = lcOf(placeholderPair(palette))
        return check(
          `${palette.scheme} placeholder is Lc ${round(lc, 0)}, outside Lc ${
            DECORATIVE_LC_BAND.low
          } to ${DECORATIVE_LC_BAND.high}`,
          lc >= DECORATIVE_LC_BAND.low && lc <= DECORATIVE_LC_BAND.high,
        )
      }),
      'placeholder text is readable when you look and quiet when you do not',
    ),
  evidence: (_theme, palettes) =>
    contrastEvidence(
      palettes,
      (palette) => [placeholderPair(palette)],
      () => DECORATIVE_TARGET,
    ),
}

const accentTextPair = (palette: Palette): Pair => ({
  label: 'accent foreground on accent',
  foreground: palette.colours.accentForeground,
  background: palette.colours.accent,
  floor: CONTRAST_FLOORS.body,
})

export const textOnAccentRule: Rule = {
  id: 'legibility/text-on-accent',
  section: 1,
  title: 'Text on the accent is whichever of white or ink scores higher',
  evaluate: (_theme, palettes) => {
    const results = [palettes.light, palettes.dark].map((palette) => {
      const { accent, ink, paper } = palette.colours
      const best = bestTextOn(accent, [{ lightness: 99.5, chroma: 0, hue: 0 }, ink, paper])
      const chosen = ratioOf(accentTextPair(palette))
      return { scheme: palette.scheme, chosen, best: best.ratio }
    })
    return fromChecks(
      results.flatMap((result) => [
        check(
          `${result.scheme} text on the accent is ${round(result.chosen)}:1, below ${CONTRAST_FLOORS.body.ratio}:1`,
          result.chosen >= CONTRAST_FLOORS.body.ratio,
        ),
        check(
          `${result.scheme} text on the accent is ${round(result.chosen)}:1 where ${round(result.best)}:1 was available`,
          result.chosen >= result.best - 0.05,
        ),
      ]),
      results
        .map((result) => `${result.scheme} text on the accent is ${round(result.chosen)}:1`)
        .join('; '),
    )
  },
  evidence: (_theme, palettes) =>
    contrastEvidence(
      palettes,
      (palette) => [accentTextPair(palette)],
      () => ({ ratio: CONTRAST_FLOORS.body.ratio }),
    ),
}

/** Section 1: neither pure white ink nor pure black paper, once the paper is dark. */
const darkInkAndPaperHold = (palette: Palette, role: 'ink' | 'paper'): boolean => {
  if (palette.scheme === 'light') return true
  const { lightness } = palette.colours[role]
  return role === 'ink'
    ? inBand(lightness, LIGHTNESS_BANDS.ink.dark) && lightness < 100
    : inBand(lightness, LIGHTNESS_BANDS.paper.dark) && lightness > 0
}

export const darkInkAndPaperRule: Rule = {
  id: 'legibility/dark-ink-and-paper',
  section: 1,
  title: 'Dark mode avoids pure white ink and pure black paper',
  evaluate: (_theme, palettes) => {
    const { ink, paper } = palettes.dark.colours
    return fromChecks(
      [
        check(
          `dark ink is L ${round(ink.lightness, 1)}, outside L 90 to 95`,
          darkInkAndPaperHold(palettes.dark, 'ink'),
        ),
        check(
          `dark paper is L ${round(paper.lightness, 1)}, outside L 15 to 22`,
          darkInkAndPaperHold(palettes.dark, 'paper'),
        ),
      ],
      'dark ink and paper sit inside their bands, neither pure white nor pure black',
    )
  },
  evidence: (_theme, palettes) => swatchEvidence(palettes, ['ink', 'paper'], darkInkAndPaperHold),
}
