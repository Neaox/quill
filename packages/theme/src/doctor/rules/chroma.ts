import {
  CHROMA_BUDGET,
  DARK_CHROMA_REDUCTION,
  WASH_CHROMA_BUDGET,
  type Scheme,
} from '../../colour/bands.ts'
import type { Colour } from '../../colour/oklch.ts'
import {
  PALETTE_ROLES,
  type Palette,
  type PaletteRole,
  type ThemePalettes,
} from '../../colour/palette.ts'
import type { ThemeDocument } from '../../schema/theme-document.ts'
import { swatchEvidence } from '../evidence.ts'
import { check, fromChecks, pass, round, warn, type Rule } from '../rule.ts'

/** Section 4: allowed chroma falls as the area a colour covers rises. */
const both = (ceiling: number): Readonly<Record<Scheme, number>> => ({
  light: ceiling,
  dark: ceiling,
})

const AREA_BUDGET: readonly (readonly [PaletteRole, Readonly<Record<Scheme, number>>])[] = [
  ['paper', both(CHROMA_BUDGET.paper)],
  ['raised', both(CHROMA_BUDGET.paper)],
  ['surface', both(CHROMA_BUDGET.panel)],
  ['codeBackground', both(CHROMA_BUDGET.panel)],
  ['border', both(CHROMA_BUDGET.border)],
  ['muted', both(CHROMA_BUDGET.muted)],
  ['accentSubtle', WASH_CHROMA_BUDGET],
  ['successSubtle', WASH_CHROMA_BUDGET],
  ['warningSubtle', WASH_CHROMA_BUDGET],
  ['dangerSubtle', WASH_CHROMA_BUDGET],
]

const withinBudget = (colour: Colour, ceiling: number): boolean => colour.chroma <= ceiling + 1e-9

/** A tone the tenant chose must survive on the paper, not be budgeted away. */
const keepsTint = (theme: ThemeDocument, role: PaletteRole, colour: Colour): boolean =>
  role !== 'paper' ||
  theme.seeds.tone.chroma === 0 ||
  colour.chroma >= CHROMA_BUDGET.paperTintMinimum

export const areaBudgetRule: Rule = {
  id: 'chroma/area-budget',
  section: 4,
  title: 'Large areas stay inside the chroma budget',
  evaluate: (theme, palettes) =>
    fromChecks(
      [palettes.light, palettes.dark].flatMap((palette) =>
        AREA_BUDGET.flatMap(([role, budget]) => {
          const colour = palette.colours[role]
          const ceiling = budget[palette.scheme]
          const checks = [
            check(
              `${palette.scheme} ${role} is C ${round(colour.chroma, 4)}, over its budget of ${ceiling}`,
              withinBudget(colour, ceiling),
            ),
          ]
          return role === 'paper' && theme.seeds.tone.chroma > 0
            ? [
                ...checks,
                check(
                  `${palette.scheme} paper lost its tint at C ${round(colour.chroma, 4)}, under ${
                    CHROMA_BUDGET.paperTintMinimum
                  }`,
                  keepsTint(theme, role, colour),
                ),
              ]
            : checks
        }),
      ),
      'every large area is within its chroma budget, and a chosen tone survives on the paper',
    ),
  evidence: (theme, palettes) =>
    AREA_BUDGET.flatMap(([role, budget]) =>
      swatchEvidence(palettes, [role], (palette) => {
        const colour = palette.colours[role]
        return withinBudget(colour, budget[palette.scheme]) && keepsTint(theme, role, colour)
      }),
    ),
}

const DARK_ACCENT_FLOOR = CHROMA_BUDGET.accentMinimum * (1 - DARK_CHROMA_REDUCTION.high)

const holdsAccentBudget = (palettes: ThemePalettes, scheme: Scheme): boolean => {
  const lightChroma = palettes.light.colours.accent.chroma
  if (scheme === 'light') {
    return (
      lightChroma >= CHROMA_BUDGET.accentMinimum - 1e-9 &&
      lightChroma <= CHROMA_BUDGET.accentMaximum + 1e-9
    )
  }
  const darkChroma = palettes.dark.colours.accent.chroma
  return darkChroma >= DARK_ACCENT_FLOOR - 1e-9 && darkChroma <= lightChroma + 1e-9
}

export const accentBudgetRule: Rule = {
  id: 'chroma/accent-budget',
  section: 4,
  title: 'The accent carries between C 0.08 and C 0.18, less in dark mode',
  evaluate: (_theme, palettes) => {
    const lightChroma = palettes.light.colours.accent.chroma
    const darkChroma = palettes.dark.colours.accent.chroma
    return fromChecks(
      [
        check(
          `light accent is C ${round(lightChroma, 4)}, outside C ${CHROMA_BUDGET.accentMinimum} to ${CHROMA_BUDGET.accentMaximum}`,
          holdsAccentBudget(palettes, 'light'),
        ),
        check(
          `dark accent is C ${round(darkChroma, 4)}, not between C ${round(DARK_ACCENT_FLOOR, 4)} and the light C ${round(lightChroma, 4)}`,
          holdsAccentBudget(palettes, 'dark'),
        ),
      ],
      `accent chroma is ${round(lightChroma, 4)} in light and ${round(darkChroma, 4)} in dark`,
    )
  },
  evidence: (_theme, palettes) =>
    swatchEvidence(palettes, ['accent'], (palette) => holdsAccentBudget(palettes, palette.scheme)),
}

const EXEMPT: ReadonlySet<PaletteRole> = new Set<PaletteRole>([
  'accent',
  'accentMark',
  'accentHover',
  'accentSubtle',
  'accentInk',
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
])

const isSaturatedOutsideAccent = (palette: Palette, role: PaletteRole): boolean =>
  !EXEMPT.has(role) && palette.colours[role].chroma > CHROMA_BUDGET.saturatedThreshold

/** Section 4: one saturated thing at a time. */
export const oneSaturatedThingRule: Rule = {
  id: 'chroma/one-saturated-thing',
  section: 4,
  title: 'Only the accent and the status set carry visible saturation',
  evaluate: (_theme, palettes) => {
    const offenders = [palettes.light, palettes.dark].flatMap((palette) =>
      PALETTE_ROLES.filter((role) => isSaturatedOutsideAccent(palette, role)).map(
        (role) => `${palette.scheme} ${role} is C ${round(palette.colours[role].chroma, 4)}`,
      ),
    )
    return offenders.length === 0
      ? pass('the accent and the status set are the only saturated element classes')
      : warn(`more than one saturated element class: ${offenders.join('; ')}`)
  },
  evidence: (_theme, palettes) =>
    swatchEvidence(
      palettes,
      PALETTE_ROLES.filter((role) => role === 'accent' || !EXEMPT.has(role)),
      (palette, role) => !isSaturatedOutsideAccent(palette, role),
    ),
}
