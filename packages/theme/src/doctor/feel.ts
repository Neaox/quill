import { RECOGNISABLE_CHROMA, SCHEMES } from '../colour/bands.ts'
import { hueDistance } from '../colour/hue.ts'
import type { Colour } from '../colour/oklch.ts'
import type { PaletteRole, ThemePalettes } from '../colour/palette.ts'

/**
 * The feel of a brand colour, and how far a suggested fix moves it.
 *
 * A fix that clears a rule by turning a dark teal wash into grey has cleared
 * the rule and lost the brand. So the brand's colours — the accent and the
 * status colours as marks, and the washes made from them — are held to two
 * things a fix may not break: a mark's hue does not move, and a colour that was
 * visibly tinted stays visibly tinted ("recognisable" is a chroma floor; in
 * OKLab, chroma is exactly the distance from the grey at the same lightness).
 * Among the fixes that keep both, the one closest to what the tenant had
 * comes first, measured so that losing colour costs more than moving
 * lightness, which is the change a reader notices least.
 */

const WASHES: ReadonlySet<string> = new Set<PaletteRole>([
  'accentSubtle',
  'selection',
  'successSubtle',
  'warningSubtle',
  'dangerSubtle',
])

const MARKS: ReadonlySet<string> = new Set<PaletteRole>([
  'accentMark',
  'accent',
  'accentHover',
  'accentInk',
  'focusRing',
  'info',
  'success',
  'warning',
  'danger',
  'dangerHover',
])

const BRAND_ROLES: readonly PaletteRole[] = [
  'accentMark',
  'accent',
  'accentHover',
  'accentInk',
  'accentSubtle',
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

/** Degrees a brand colour's hue may move before it is a different colour. */
const HUE_TOLERANCE = 1

/** How much more a step of chroma, or of hue, counts than the same step of lightness. */
const COLOUR_WEIGHT = 2

const floorFor = (role: string): number | undefined => {
  if (WASHES.has(role)) return RECOGNISABLE_CHROMA.wash
  return MARKS.has(role) ? RECOGNISABLE_CHROMA.mark : undefined
}

/**
 * True unless a brand colour that was recognisably tinted has gone grey or
 * changed hue. A colour that was grey to begin with, or a role that is not
 * the brand's, has no feel to lose.
 */
export const keepsTheFeel = (role: string, before: Colour, after: Colour): boolean => {
  const floor = floorFor(role)
  if (floor === undefined || before.chroma < floor) return true
  // A wash's hue is a result of mixing into the page, and follows the page's
  // undertone; a mark's hue is the brand's own.
  const turned = MARKS.has(role) && hueDistance(before.hue, after.hue) > HUE_TOLERANCE
  return after.chroma >= floor - 1e-9 && !turned
}

/**
 * OKLab distance with chroma and hue counted double: ΔH is the hue turn as an
 * arc at the colours' chroma, so turning a grey costs nothing.
 */
export const weightedDeltaE = (before: Colour, after: Colour): number => {
  const lightness = (before.lightness - after.lightness) / 100
  const chroma = before.chroma - after.chroma
  const turn = (hueDistance(before.hue, after.hue) * Math.PI) / 180
  const hue = 2 * Math.sqrt(before.chroma * after.chroma) * Math.sin(turn / 2)
  return Math.hypot(lightness, COLOUR_WEIGHT * chroma, COLOUR_WEIGHT * hue)
}

export const isBrandRole = (role: string): boolean => WASHES.has(role) || MARKS.has(role)

/** The greys: the page and its surfaces, borders and the inks set on them. */
const GREY_ROLES: readonly PaletteRole[] = [
  'paper',
  'surface',
  'raised',
  'border',
  'borderStrong',
  'muted',
  'body',
  'ink',
  'codeBackground',
]

/**
 * How much more moving a brand colour costs than moving a grey by the same
 * amount: the brand is what the tenant chose, the room around it is ours.
 */
const BRAND_WEIGHT = 3

const distanceOver = (
  roles: readonly PaletteRole[],
  before: ThemePalettes,
  after: ThemePalettes,
): number =>
  SCHEMES.reduce(
    (total, scheme) =>
      total +
      roles.reduce(
        (sum, role) =>
          sum + weightedDeltaE(before[scheme].colours[role], after[scheme].colours[role]),
        0,
      ),
    0,
  )

/** How far the greys moved between two palettes, over both schemes. */
export const greyDistance = (before: ThemePalettes, after: ThemePalettes): number =>
  distanceOver(GREY_ROLES, before, after)

/**
 * The total perceived change a fix makes, the brand's colours counting
 * `BRAND_WEIGHT` times a grey's: so where the brand cannot move without
 * losing its feel, or would have to move further than the room around it,
 * the fix that moves the room comes first.
 */
export const changeCost = (before: ThemePalettes, after: ThemePalettes): number =>
  BRAND_WEIGHT * brandDistance(before, after) + greyDistance(before, after)

/** How far the brand's colours moved between two palettes, over both schemes. */
export const brandDistance = (before: ThemePalettes, after: ThemePalettes): number =>
  distanceOver(BRAND_ROLES, before, after)

/** True when every brand colour keeps its feel in both schemes. */
export const keepsTheBrand = (before: ThemePalettes, after: ThemePalettes): boolean =>
  SCHEMES.every((scheme) =>
    BRAND_ROLES.every((role) =>
      keepsTheFeel(role, before[scheme].colours[role], after[scheme].colours[role]),
    ),
  )
