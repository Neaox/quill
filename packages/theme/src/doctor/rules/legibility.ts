import { LIGHTNESS_BANDS, inBand } from '../../colour/bands.ts'
import { bestTextOn } from '../../contrast/best-text-on.ts'
import { CONTRAST_FLOORS, DECORATIVE_LC_BAND } from '../../contrast/floors.ts'
import { boundaryPairs, describe, holds, lcOf, ratioOf, syntaxPairs, textPairs } from '../pairs.ts'
import { check, fromChecks, pass, round, warn, type Rule } from '../rule.ts'

/** Section 1: the measured, non-negotiable floors. */
export const textContrastRule: Rule = {
  id: 'legibility/text-contrast',
  section: 1,
  title: 'Text contrast meets WCAG 2.2 AA and the APCA floor',
  evaluate: (_theme, palettes) => {
    const failures = [palettes.light, palettes.dark]
      .flatMap((palette) => [...textPairs(palette), ...syntaxPairs(palette)])
      .filter((pair) => !holds(pair))
    return failures.length === 0
      ? pass('every text pair clears its AA ratio and APCA floor in both schemes')
      : warn(failures.map(describe).join('; '))
  },
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
}

export const decorativeTextRule: Rule = {
  id: 'legibility/decorative-text',
  section: 1,
  title: 'Placeholder text stays inside the decorative band',
  evaluate: (_theme, palettes) =>
    fromChecks(
      [palettes.light, palettes.dark].map((palette) => {
        const lc = lcOf({
          label: 'placeholder',
          foreground: palette.colours.placeholder,
          background: palette.colours.paper,
          floor: CONTRAST_FLOORS.nonText,
        })
        return check(
          `${palette.scheme} placeholder is Lc ${round(lc, 0)}, outside Lc ${
            DECORATIVE_LC_BAND.low
          } to ${DECORATIVE_LC_BAND.high}`,
          lc >= DECORATIVE_LC_BAND.low && lc <= DECORATIVE_LC_BAND.high,
        )
      }),
      'placeholder text is readable when you look and quiet when you do not',
    ),
}

export const textOnAccentRule: Rule = {
  id: 'legibility/text-on-accent',
  section: 1,
  title: 'Text on the accent is whichever of white or ink scores higher',
  evaluate: (_theme, palettes) => {
    const results = [palettes.light, palettes.dark].map((palette) => {
      const { accent, accentForeground, ink, paper } = palette.colours
      const best = bestTextOn(accent, [{ lightness: 99.5, chroma: 0, hue: 0 }, ink, paper])
      const chosen = ratioOf({
        label: 'accent foreground',
        foreground: accentForeground,
        background: accent,
        floor: CONTRAST_FLOORS.body,
      })
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
          inBand(ink.lightness, LIGHTNESS_BANDS.ink.dark) && ink.lightness < 100,
        ),
        check(
          `dark paper is L ${round(paper.lightness, 1)}, outside L 15 to 22`,
          inBand(paper.lightness, LIGHTNESS_BANDS.paper.dark) && paper.lightness > 0,
        ),
      ],
      'dark ink and paper sit inside their bands, neither pure white nor pure black',
    )
  },
}
