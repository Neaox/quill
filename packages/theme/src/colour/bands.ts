/**
 * The committed numbers from `docs/design/colour-rules.md`, sections 3, 4 and 7.
 *
 * They are data, not logic: the generator reads the target lightness, the
 * doctor reads the band, and neither restates a number the other owns.
 */

export type Scheme = 'light' | 'dark'

export type Band = { readonly low: number; readonly high: number }

export type NeutralRole = 'paper' | 'surface' | 'raised' | 'border' | 'muted' | 'ink'

/** Section 3: lightness bands per role. */
export const LIGHTNESS_BANDS: Record<NeutralRole | 'accent', Record<Scheme, Band>> = {
  paper: { light: { low: 96, high: 99 }, dark: { low: 15, high: 22 } },
  surface: { light: { low: 93, high: 97 }, dark: { low: 19, high: 26 } },
  raised: { light: { low: 96, high: 100 }, dark: { low: 22, high: 29 } },
  border: { light: { low: 85, high: 92 }, dark: { low: 28, high: 35 } },
  muted: { light: { low: 45, high: 55 }, dark: { low: 65, high: 75 } },
  ink: { light: { low: 18, high: 28 }, dark: { low: 90, high: 95 } },
  accent: { light: { low: 40, high: 55 }, dark: { low: 65, high: 78 } },
}

/**
 * Where inside each band this system sits. Chosen once so every generated
 * theme shares a tonal register, as section 3 intends.
 */
export const TARGET_LIGHTNESS: Record<NeutralRole, Record<Scheme, number>> = {
  paper: { light: 98.5, dark: 18.5 },
  surface: { light: 96.5, dark: 22 },
  raised: { light: 99.5, dark: 25 },
  border: { light: 90.5, dark: 31 },
  muted: { light: 50, dark: 70 },
  ink: { light: 24, dark: 92.5 },
}

/** Section 3: a surface must read as a surface, not as paper with a shadow. */
export const SURFACE_SEPARATION: Record<Scheme, number> = { light: 1.5, dark: 2.5 }

/** Section 3: a raised surface steps further from the paper in both schemes. */
export const RAISED_SEPARATION: Record<Scheme, number> = { light: 1, dark: 3 }

/** Section 4: allowed chroma falls as the area a colour covers rises. */
export const CHROMA_BUDGET = {
  paper: 0.012,
  paperTintMinimum: 0.004,
  panel: 0.02,
  border: 0.015,
  muted: 0.02,
  accentMinimum: 0.08,
  accentMaximum: 0.18,
  /** "One saturated thing at a time": the ceiling for a non-accent surface. */
  saturatedThreshold: 0.05,
} as const

/** Section 4 and 7: dark mode keeps the hue and loses 20 to 30 percent of the chroma. */
export const DARK_CHROMA_REDUCTION = { low: 0.2, high: 0.3, chosen: 0.25 } as const

/** Section 4: an accent used as a background tint is a mix, never its own chroma. */
export const ACCENT_TINT_MIX: Record<Scheme, number> = { light: 0.11, dark: 0.14 }

/** Section 6: the doctor warns when the accent covers more than this. */
export const MAX_ACCENT_COVERAGE = 0.12

/** Section 5: the fixed status hue bands, and the separation the accent owes them. */
export const STATUS_HUE_BANDS = {
  success: { low: 145, high: 155 },
  warning: { low: 75, high: 85 },
  danger: { low: 25, high: 30 },
} as const

export const MIN_ACCENT_STATUS_SEPARATION = 40

/** Section 5: two accents agree when they share lightness and chroma. */
export const STATUS_MATCH_TOLERANCE = { lightness: 5, chroma: 0.02 } as const

/** Section 5: a tinted neutral must be analogous to, or complementary with, the accent. */
export const NEUTRAL_TINT_VISIBLE_CHROMA = 0.006
export const ANALOGOUS_LIMIT = 60
export const COMPLEMENTARY_BAND: Band = { low: 150, high: 210 }

export const inBand = (value: number, band: Band): boolean =>
  value >= band.low && value <= band.high

export const clampToBand = (value: number, band: Band): number =>
  Math.min(Math.max(value, band.low), band.high)
