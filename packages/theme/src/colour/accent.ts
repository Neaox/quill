import { apcaLc } from '../contrast/apca.ts'
import { bestTextOn } from '../contrast/best-text-on.ts'
import { CONTRAST_FLOORS } from '../contrast/floors.ts'
import { contrastRatio } from '../contrast/wcag.ts'
import type { AccentSeedValue } from '../schema/theme-document.ts'
import type { Adjustment } from './adjustment.ts'
import {
  CHROMA_BUDGET,
  DARK_CHROMA_REDUCTION,
  LIGHTNESS_BANDS,
  clampToBand,
  type Scheme,
} from './bands.ts'
import {
  NO_CEILING,
  recordClamp,
  settleContrast,
  settleGamut,
  type ChromaCeiling,
  type Derived,
} from './derive.ts'
import type { NeutralRole } from './neutral-ramp.ts'
import { mix, withChroma, type Colour } from './oklch.ts'
import { buildTint } from './tint.ts'

/** Every palette role derived from the accent seed, and from nothing else. */
export const ACCENT_ROLES = [
  'accentMark',
  'accent',
  'accentHover',
  'accentForeground',
  'accentSubtle',
  'accentInk',
  'focusRing',
  'selection',
] as const

export type AccentRole = (typeof ACCENT_ROLES)[number]

export type AccentVariants = {
  readonly colours: Readonly<Record<AccentRole, Colour>>
  readonly adjustments: readonly Adjustment[]
}

/** How far a hover state moves, and how much chroma it gives back in dark mode. */
const HOVER = {
  light: { lightness: -6, chroma: 1 },
  dark: { lightness: 7, chroma: 0.72 },
} as const

const SELECTION_MIX: Record<Scheme, number> = { light: 0.28, dark: 0.34 }

const DEFAULT_SEED_LIGHTNESS: Record<Scheme, number> = { light: 55, dark: 70 }

/**
 * The accent as text on the page — an eyebrow, an active entry, a link that
 * is coloured — sits a step further from the paper than the accent a control
 * is filled with: darker in light, brighter in dark. lockstay's portal calls
 * it `accent-ink` and keeps it at L 40 against L 43, and L 84 against L 78.
 */
const INK_STEP: Record<Scheme, number> = { light: -3, dark: 6 }
const INK_CEILING = 92

export const hoverOf = (
  colour: Colour,
  scheme: Scheme,
  ceiling = Number.POSITIVE_INFINITY,
): Colour => ({
  ...colour,
  lightness: colour.lightness + HOVER[scheme].lightness,
  chroma: Math.min(colour.chroma * HOVER[scheme].chroma, ceiling),
})

/**
 * The chroma an accent may carry in small areas (section 4), reduced in dark
 * mode so it feels as saturated as it did in light.
 */
export const accentChromaFor = (seedChroma: number, scheme: Scheme): number => {
  const light = Math.min(
    Math.max(seedChroma, CHROMA_BUDGET.accentMinimum),
    CHROMA_BUDGET.accentMaximum,
  )
  return scheme === 'dark' ? light * (1 - DARK_CHROMA_REDUCTION.chosen) : light
}

/**
 * Accent variants. The tenant's exact colour survives as the mark; the text
 * and control colour is the one the contrast floors are allowed to move,
 * which is the bargain ADR-028 strikes with a brand hex.
 */
export const buildAccentVariants = (
  seed: AccentSeedValue,
  scheme: Scheme,
  neutral: Readonly<Record<NeutralRole, Colour>>,
  cap: ChromaCeiling<AccentRole> = NO_CEILING,
): AccentVariants => {
  const adjustments: Adjustment[] = []
  const take = (derived: Derived): Colour => {
    adjustments.push(...derived.adjustments)
    return derived.colour
  }

  const seedLightness = seed.lightness ?? DEFAULT_SEED_LIGHTNESS[scheme]
  /*
   * The mark is the brand's own colour and keeps its light lightness in both
   * schemes; the accent proper may start somewhere else in dark mode, when
   * the brand says where.
   */
  const accentStart =
    scheme === 'dark' && seed.darkLightness !== undefined ? seed.darkLightness : seedLightness
  const accentMark = take(
    settleGamut('accentMark', {
      lightness: seedLightness,
      chroma: Math.min(seed.chroma, cap('accentMark')),
      hue: seed.hue,
    }),
  )

  const band = LIGHTNESS_BANDS.accent[scheme]
  const chroma = Math.min(accentChromaFor(seed.chroma, scheme), cap('accent'))
  const startLightness = clampToBand(accentStart, band)
  adjustments.push(
    ...recordClamp('accent', 'chroma', 'budget', seed.chroma, chroma),
    ...recordClamp('accent', 'lightness', 'band', accentStart, startLightness),
  )

  const foregroundCandidates: readonly [Colour, Colour] =
    scheme === 'light'
      ? [{ lightness: 99.5, chroma: 0, hue: 0 }, neutral.ink]
      : [neutral.paper, neutral.ink]

  const accent = take(
    settleContrast('accent', { lightness: startLightness, chroma, hue: seed.hue }, (candidate) => {
      const floor = CONTRAST_FLOORS.secondary
      const grounds = [neutral.paper, neutral.surface, neutral.raised]
      return (
        grounds.every(
          (ground) =>
            contrastRatio(candidate, ground) >= floor.ratio &&
            apcaLc(candidate, ground) >= floor.lc,
        ) && bestTextOn(candidate, foregroundCandidates).ratio >= floor.ratio
      )
    }),
  )

  const accentHover = take(settleGamut('accentHover', hoverOf(accent, scheme, cap('accentHover'))))
  const chosen = bestTextOn(accent, foregroundCandidates).colour
  const accentForeground = withChroma(chosen, Math.min(chosen.chroma, cap('accentForeground')))
  const accentSubtle = take(buildTint('accentSubtle', accent, scheme, neutral, cap('accentSubtle')))

  const accentInk = take(
    settleContrast(
      'accentInk',
      {
        ...accent,
        lightness: Math.min(accent.lightness + INK_STEP[scheme], INK_CEILING),
        chroma: Math.min(accent.chroma, cap('accentInk')),
      },
      (candidate) =>
        [neutral.paper, neutral.surface, neutral.raised].every(
          (ground) =>
            contrastRatio(candidate, ground) >= CONTRAST_FLOORS.secondary.ratio &&
            apcaLc(candidate, ground) >= CONTRAST_FLOORS.secondary.lc,
        ),
    ),
  )

  const selected = mix(accent, neutral.paper, SELECTION_MIX[scheme])
  const selection = take(
    settleContrast(
      'selection',
      withChroma(selected, Math.min(selected.chroma, cap('selection'))),
      (candidate) =>
        contrastRatio(neutral.ink, candidate) >= CONTRAST_FLOORS.body.ratio &&
        apcaLc(neutral.ink, candidate) >= CONTRAST_FLOORS.body.lc,
    ),
  )

  return {
    colours: {
      accentMark,
      accent,
      accentHover,
      accentForeground,
      accentSubtle,
      accentInk,
      focusRing: accent,
      selection,
    },
    adjustments,
  }
}
