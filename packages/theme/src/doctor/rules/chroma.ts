import { CHROMA_BUDGET, DARK_CHROMA_REDUCTION } from '../../colour/bands.ts'
import type { PaletteRole } from '../../colour/palette.ts'
import { check, fromChecks, pass, round, warn, type Rule } from '../rule.ts'

/** Section 4: allowed chroma falls as the area a colour covers rises. */
const AREA_BUDGET: readonly (readonly [PaletteRole, number])[] = [
  ['paper', CHROMA_BUDGET.paper],
  ['raised', CHROMA_BUDGET.paper],
  ['surface', CHROMA_BUDGET.panel],
  ['codeBackground', CHROMA_BUDGET.panel],
  ['border', CHROMA_BUDGET.border],
  ['muted', CHROMA_BUDGET.muted],
  ['accentSubtle', CHROMA_BUDGET.panel],
  ['successSubtle', CHROMA_BUDGET.panel],
  ['warningSubtle', CHROMA_BUDGET.panel],
  ['dangerSubtle', CHROMA_BUDGET.panel],
]

export const areaBudgetRule: Rule = {
  id: 'chroma/area-budget',
  section: 4,
  title: 'Large areas stay inside the chroma budget',
  evaluate: (theme, palettes) =>
    fromChecks(
      [palettes.light, palettes.dark].flatMap((palette) =>
        AREA_BUDGET.flatMap(([role, ceiling]) => {
          const colour = palette.colours[role]
          const checks = [
            check(
              `${palette.scheme} ${role} is C ${round(colour.chroma, 4)}, over its budget of ${ceiling}`,
              colour.chroma <= ceiling + 1e-9,
            ),
          ]
          return role === 'paper' && theme.seeds.tone.chroma > 0
            ? [
                ...checks,
                check(
                  `${palette.scheme} paper lost its tint at C ${round(colour.chroma, 4)}, under ${
                    CHROMA_BUDGET.paperTintMinimum
                  }`,
                  colour.chroma >= CHROMA_BUDGET.paperTintMinimum,
                ),
              ]
            : checks
        }),
      ),
      'every large area is within its chroma budget, and a chosen tone survives on the paper',
    ),
}

export const accentBudgetRule: Rule = {
  id: 'chroma/accent-budget',
  section: 4,
  title: 'The accent carries between C 0.08 and C 0.18, less in dark mode',
  evaluate: (_theme, palettes) => {
    const lightChroma = palettes.light.colours.accent.chroma
    const darkChroma = palettes.dark.colours.accent.chroma
    const darkFloor = CHROMA_BUDGET.accentMinimum * (1 - DARK_CHROMA_REDUCTION.high)
    return fromChecks(
      [
        check(
          `light accent is C ${round(lightChroma, 4)}, outside C ${CHROMA_BUDGET.accentMinimum} to ${CHROMA_BUDGET.accentMaximum}`,
          lightChroma >= CHROMA_BUDGET.accentMinimum - 1e-9 &&
            lightChroma <= CHROMA_BUDGET.accentMaximum + 1e-9,
        ),
        check(
          `dark accent is C ${round(darkChroma, 4)}, not between C ${round(darkFloor, 4)} and the light C ${round(lightChroma, 4)}`,
          darkChroma >= darkFloor - 1e-9 && darkChroma <= lightChroma + 1e-9,
        ),
      ],
      `accent chroma is ${round(lightChroma, 4)} in light and ${round(darkChroma, 4)} in dark`,
    )
  },
}

const EXEMPT: readonly PaletteRole[] = [
  'accent',
  'accentMark',
  'accentHover',
  'accentSubtle',
  'accentForeground',
  'focusRing',
  'selection',
  'info',
  'success',
  'successSubtle',
  'warning',
  'warningSubtle',
  'danger',
  'dangerHover',
  'dangerSubtle',
]

/** Section 4: one saturated thing at a time. */
export const oneSaturatedThingRule: Rule = {
  id: 'chroma/one-saturated-thing',
  section: 4,
  title: 'Only the accent and the status set carry visible saturation',
  evaluate: (_theme, palettes) => {
    const offenders = [palettes.light, palettes.dark].flatMap((palette) =>
      Object.entries(palette.colours)
        .filter(
          ([role, colour]) =>
            !EXEMPT.some((exempt) => exempt === role) &&
            colour.chroma > CHROMA_BUDGET.saturatedThreshold,
        )
        .map(([role, colour]) => `${palette.scheme} ${role} is C ${round(colour.chroma, 4)}`),
    )
    return offenders.length === 0
      ? pass('the accent and the status set are the only saturated element classes')
      : warn(`more than one saturated element class: ${offenders.join('; ')}`)
  },
}
