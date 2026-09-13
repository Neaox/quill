import { apcaLc } from '../contrast/apca.ts'
import { CONTRAST_FLOORS, DECORATIVE_LC_BAND } from '../contrast/floors.ts'
import { contrastRatio } from '../contrast/wcag.ts'
import type { ToneSeedValue } from '../schema/theme-document.ts'
import type { Adjustment } from './adjustment.ts'
import { CHROMA_BUDGET, DARK_CHROMA_REDUCTION, TARGET_LIGHTNESS, type Scheme } from './bands.ts'
import {
  NO_CEILING,
  settleContrast,
  settleGamut,
  type ChromaCeiling,
  type Derived,
} from './derive.ts'
import type { Colour } from './oklch.ts'

export type NeutralRole =
  | 'paper'
  | 'surface'
  | 'raised'
  | 'border'
  | 'borderStrong'
  | 'muted'
  | 'ink'
  | 'codeBackground'
  | 'placeholder'

export type NeutralRamp = {
  readonly colours: Readonly<Record<NeutralRole, Colour>>
  readonly adjustments: readonly Adjustment[]
}

/**
 * How far each role may stray from the tone's own chroma. Section 4's area
 * effect in one table: the bigger the area, the tighter the leash.
 */
const CHROMA_FACTORS: Record<NeutralRole, { readonly factor: number; readonly ceiling: number }> = {
  paper: { factor: 1, ceiling: CHROMA_BUDGET.paper },
  raised: { factor: 1, ceiling: CHROMA_BUDGET.paper },
  surface: { factor: 1.5, ceiling: CHROMA_BUDGET.panel },
  codeBackground: { factor: 1.5, ceiling: CHROMA_BUDGET.panel },
  border: { factor: 1.5, ceiling: CHROMA_BUDGET.border },
  borderStrong: { factor: 2, ceiling: CHROMA_BUDGET.muted },
  muted: { factor: 2, ceiling: CHROMA_BUDGET.muted },
  placeholder: { factor: 2, ceiling: CHROMA_BUDGET.muted },
  ink: { factor: 2.5, ceiling: 0.025 },
}

/** Where the two roles the bands table does not name start before contrast settles them. */
const EXTRA_TARGETS = {
  borderStrong: { light: 62, dark: 55 },
  codeBackground: {
    light: TARGET_LIGHTNESS.surface.light - 0.5,
    dark: TARGET_LIGHTNESS.surface.dark + 1,
  },
  placeholder: { light: TARGET_LIGHTNESS.muted.light, dark: TARGET_LIGHTNESS.muted.dark },
} as const

const chromaFor = (
  role: NeutralRole,
  tone: ToneSeedValue,
  scheme: Scheme,
  cap: ChromaCeiling<NeutralRole>,
): number => {
  const { factor, ceiling } = CHROMA_FACTORS[role]
  const base = Math.min(tone.chroma * factor, ceiling)
  const scaled = scheme === 'dark' ? base * (1 - DARK_CHROMA_REDUCTION.chosen) : base
  return Math.min(scaled, cap(role))
}

const lightnessFor = (role: NeutralRole, scheme: Scheme): number => {
  if (role === 'borderStrong' || role === 'codeBackground' || role === 'placeholder') {
    return EXTRA_TARGETS[role][scheme]
  }
  return TARGET_LIGHTNESS[role][scheme]
}

const seed = (
  role: NeutralRole,
  tone: ToneSeedValue,
  scheme: Scheme,
  cap: ChromaCeiling<NeutralRole>,
): Colour => ({
  lightness: lightnessFor(role, scheme),
  chroma: chromaFor(role, tone, scheme, cap),
  hue: tone.hue,
})

/**
 * The neutral ramp: one hue, one chroma budget, fixed lightness steps. Hue is
 * constant along the ramp on purpose (section 2) — that is what stops a warm
 * paper turning pink as it darkens.
 */
export const buildNeutralRamp = (
  tone: ToneSeedValue,
  scheme: Scheme,
  cap: ChromaCeiling<NeutralRole> = NO_CEILING,
): NeutralRamp => {
  const adjustments: Adjustment[] = []
  const take = (derived: Derived): Colour => {
    adjustments.push(...derived.adjustments)
    return derived.colour
  }

  const paper = take(settleGamut('paper', seed('paper', tone, scheme, cap)))
  const surface = take(settleGamut('surface', seed('surface', tone, scheme, cap)))
  const raised = take(settleGamut('raised', seed('raised', tone, scheme, cap)))
  const border = take(settleGamut('border', seed('border', tone, scheme, cap)))
  const codeBackground = take(
    settleGamut('codeBackground', seed('codeBackground', tone, scheme, cap)),
  )

  const ink = take(
    settleContrast('ink', seed('ink', tone, scheme, cap), (candidate) => {
      const floor = CONTRAST_FLOORS.body
      return (
        contrastRatio(candidate, paper) >= floor.ratio &&
        contrastRatio(candidate, surface) >= floor.ratio &&
        apcaLc(candidate, paper) >= floor.lc
      )
    }),
  )

  const muted = take(
    settleContrast('muted', seed('muted', tone, scheme, cap), (candidate) => {
      const floor = CONTRAST_FLOORS.secondary
      return (
        contrastRatio(candidate, paper) >= floor.ratio &&
        contrastRatio(candidate, surface) >= floor.ratio &&
        apcaLc(candidate, paper) >= floor.lc
      )
    }),
  )

  const borderStrong = take(
    settleContrast('borderStrong', seed('borderStrong', tone, scheme, cap), (candidate) =>
      [paper, surface, raised].every(
        (ground) =>
          contrastRatio(candidate, ground) >= CONTRAST_FLOORS.nonText.ratio &&
          apcaLc(candidate, ground) >= CONTRAST_FLOORS.nonText.lc,
      ),
    ),
  )

  const placeholder = take(
    settleContrast('placeholder', seed('placeholder', tone, scheme, cap), (candidate) => {
      const lc = apcaLc(candidate, paper)
      return lc >= DECORATIVE_LC_BAND.low && lc <= DECORATIVE_LC_BAND.high
    }),
  )

  return {
    colours: {
      paper,
      surface,
      raised,
      border,
      borderStrong,
      muted,
      ink,
      codeBackground,
      placeholder,
    },
    adjustments,
  }
}
