import { apcaLc } from '../contrast/apca.ts'
import { CONTRAST_FLOORS } from '../contrast/floors.ts'
import { contrastRatio } from '../contrast/wcag.ts'
import type { ThemeDocument } from '../schema/theme-document.ts'
import type { Adjustment } from './adjustment.ts'
import {
  DARK_CHROMA_REDUCTION,
  MIN_ACCENT_STATUS_SEPARATION,
  STATUS_HUE_BANDS,
  type Scheme,
} from './bands.ts'
import { hoverOf } from './accent.ts'
import {
  NO_CEILING,
  recordClamp,
  settleContrast,
  settleGamut,
  type ChromaCeiling,
  type Derived,
} from './derive.ts'
import { clampHue, compensateChroma, hueDistance, shiftHueAway } from './hue.ts'
import { mapIntoGamut, type Colour } from './oklch.ts'
import { buildTint } from './tint.ts'

export type StatusName = 'success' | 'warning' | 'danger'

export const STATUS_NAMES: readonly StatusName[] = ['success', 'warning', 'danger']

export type StatusRole =
  | 'success'
  | 'successSubtle'
  | 'successInk'
  | 'warning'
  | 'warningSubtle'
  | 'warningInk'
  | 'danger'
  | 'dangerHover'
  | 'dangerSubtle'
  | 'dangerInk'
  | 'info'

export type StatusSet = {
  readonly colours: Readonly<Record<StatusRole, Colour>>
  readonly adjustments: readonly Adjustment[]
}

/** Section 5: a fixed set at matched lightness and chroma. */
const BASE_HUES: Record<StatusName, number> = { success: 150, warning: 80, danger: 27.5 }
const BASE_CHROMA = 0.14
const STATUS_LIGHTNESS: Record<Scheme, number> = { light: 48, dark: 72 }

type StatusOverrides = NonNullable<ThemeDocument['seeds']['statusOverrides']>

/**
 * A status's ink: its colour, read as text on its own fill (`:ok[Built]`'s
 * words on their pill), so it is held to the floor body text is held to,
 * not the secondary floor a status mark on the page meets. Same hue and
 * chroma as the status; only its lightness moves, away from the fill: up in
 * dark, down in light (ADR-028, amended 2026-11-10).
 */
/**
 * A little past the floor, so the colour still clears it once it is written
 * out to the precision a stylesheet carries.
 */
const INK_MARGIN_LC = 1

export const statusInk = (
  role: 'successInk' | 'warningInk' | 'dangerInk',
  status: Colour,
  fill: Colour,
  scheme: Scheme,
): Derived =>
  settleContrast(
    role,
    status,
    (candidate) =>
      contrastRatio(candidate, fill) >= CONTRAST_FLOORS.body.ratio &&
      Math.abs(apcaLc(candidate, fill)) >= CONTRAST_FLOORS.body.lc + INK_MARGIN_LC,
    { direction: scheme === 'dark' ? 'lighter' : 'darker' },
  )

/**
 * Keep a status hue distinguishable from the accent, moving it away as far as
 * its band allows. The band wins: a "danger" that is no longer red is worse
 * than one that sits nearer the accent than we would like.
 */
export const separateFromAccent = (
  name: StatusName,
  hue: number,
  accentHue: number,
): { hue: number; shifted: boolean } => {
  const distance = hueDistance(hue, accentHue)
  if (distance >= MIN_ACCENT_STATUS_SEPARATION) return { hue, shifted: false }
  const band = STATUS_HUE_BANDS[name]
  const wanted = shiftHueAway(hue, accentHue, MIN_ACCENT_STATUS_SEPARATION - distance)
  const clamped = clampHue(wanted, band.low, band.high)
  return { hue: clamped, shifted: clamped !== hue }
}

export const buildStatusSet = (
  accent: Colour,
  accentHue: number,
  scheme: Scheme,
  neutral: { readonly paper: Colour; readonly surface: Colour; readonly ink: Colour },
  overrides: StatusOverrides = {},
  cap: ChromaCeiling<StatusRole> = NO_CEILING,
): StatusSet => {
  const adjustments: Adjustment[] = []
  const take = (derived: Derived): Colour => {
    adjustments.push(...derived.adjustments)
    return derived.colour
  }

  const lightness = STATUS_LIGHTNESS[scheme]

  const plan = (name: StatusName): { hue: number; chroma: number } => {
    const override = overrides[name]
    const band = STATUS_HUE_BANDS[name]
    const requested = override?.hue ?? BASE_HUES[name]
    const banded = clampHue(requested, band.low, band.high)
    adjustments.push(...recordClamp(name, 'hue', 'band', requested, banded))

    const separated = separateFromAccent(name, banded, accentHue)
    adjustments.push(...recordClamp(name, 'hue', 'separation', banded, separated.hue))

    const requestedChroma = override?.chroma ?? BASE_CHROMA
    const compensated = compensateChroma(requestedChroma, separated.hue)
    adjustments.push(...recordClamp(name, 'chroma', 'compensation', requestedChroma, compensated))
    const scaled =
      scheme === 'dark' ? compensated * (1 - DARK_CHROMA_REDUCTION.chosen) : compensated
    return { hue: separated.hue, chroma: Math.min(scaled, cap(name)) }
  }

  const planned: Record<StatusName, { hue: number; chroma: number }> = {
    success: plan('success'),
    warning: plan('warning'),
    danger: plan('danger'),
  }

  /**
   * Section 5 wants the set to share chroma, and section 2 forbids clipping,
   * so the most constrained hue sets the ceiling for all three. Scaling the
   * set together keeps the hue compensation intact while bringing the widest
   * chroma gap back inside the matching tolerance.
   */
  const feasibleScale = Math.min(
    ...STATUS_NAMES.map((name) => {
      const { hue, chroma } = planned[name]
      if (chroma === 0) return 1
      return mapIntoGamut({ lightness, chroma, hue }).colour.chroma / chroma
    }),
  )

  const build = (name: StatusName): Colour => {
    const { hue, chroma } = planned[name]
    const scaled = chroma * feasibleScale
    adjustments.push(...recordClamp(name, 'chroma', 'gamut', chroma, scaled))
    return take(
      settleContrast(name, { lightness, chroma: scaled, hue }, (candidate) => {
        const floor = CONTRAST_FLOORS.secondary
        return (
          contrastRatio(candidate, neutral.paper) >= floor.ratio &&
          contrastRatio(candidate, neutral.surface) >= floor.ratio &&
          apcaLc(candidate, neutral.paper) >= floor.lc
        )
      }),
    )
  }

  const success = build('success')
  const warning = build('warning')
  const danger = build('danger')
  const subtle = (colour: Colour, role: StatusRole): Colour =>
    take(buildTint(role, colour, scheme, neutral, cap(role)))

  const successSubtle = subtle(success, 'successSubtle')
  const warningSubtle = subtle(warning, 'warningSubtle')
  const dangerSubtle = subtle(danger, 'dangerSubtle')
  return {
    colours: {
      success,
      successSubtle,
      successInk: take(statusInk('successInk', success, successSubtle, scheme)),
      warning,
      warningSubtle,
      warningInk: take(statusInk('warningInk', warning, warningSubtle, scheme)),
      danger,
      dangerHover: take(settleGamut('dangerHover', hoverOf(danger, scheme, cap('dangerHover')))),
      dangerSubtle,
      dangerInk: take(statusInk('dangerInk', danger, dangerSubtle, scheme)),
      info: accent,
    },
    adjustments,
  }
}
