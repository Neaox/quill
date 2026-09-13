/** Hue arithmetic for the relationships in `docs/design/colour-rules.md`, section 5. */

export const normaliseHue = (hue: number): number => ((hue % 360) + 360) % 360

/** Shortest angular distance between two hues, 0 to 180 degrees. */
export const hueDistance = (a: number, b: number): number => {
  const raw = Math.abs(normaliseHue(a) - normaliseHue(b))
  return raw > 180 ? 360 - raw : raw
}

/**
 * Move `hue` `by` degrees directly away from `from`, so a status colour that
 * sits too close to the accent walks in the direction that buys separation.
 */
export const shiftHueAway = (hue: number, from: number, by: number): number => {
  const signed = normaliseHue(hue - from)
  const awayIsUp = signed <= 180
  return normaliseHue(hue + (awayIsUp ? by : -by))
}

/** Clamp a hue to an inclusive band, taking the nearer end when outside it. */
export const clampHue = (hue: number, low: number, high: number): number =>
  Math.min(Math.max(normaliseHue(hue), low), high)

const YELLOW_GREEN_CENTRE = 120
const BLUE_CENTRE = 260
const COMPENSATION_WIDTH = 60

/** The maximum hue-dependent chroma adjustment the rules allow (section 2). */
export const MAX_CHROMA_COMPENSATION = 0.15

/** A raised cosine that is 1 at `centre` and 0 at `centre +/- width`. */
const bump = (hue: number, centre: number): number => {
  const distance = hueDistance(hue, centre)
  if (distance >= COMPENSATION_WIDTH) return 0
  return (1 + Math.cos((Math.PI * distance) / COMPENSATION_WIDTH)) / 2
}

/**
 * The same chroma reads more saturated in yellow-greens and less in blues, so
 * a set of hues meant to feel equal gets up to a 15 percent correction.
 */
export const chromaCompensationFactor = (hue: number): number =>
  1 -
  MAX_CHROMA_COMPENSATION * bump(hue, YELLOW_GREEN_CENTRE) +
  MAX_CHROMA_COMPENSATION * bump(hue, BLUE_CENTRE)

export const compensateChroma = (chroma: number, hue: number): number =>
  chroma * chromaCompensationFactor(hue)
