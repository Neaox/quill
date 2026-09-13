import { withLightness, type Colour } from '../colour/oklch.ts'

export type NudgeDirection = 'darker' | 'lighter' | 'auto'

export type NudgeOptions = {
  readonly direction?: NudgeDirection
  readonly step?: number
  readonly minimum?: number
  readonly maximum?: number
}

export type NudgeResult = {
  readonly colour: Colour
  readonly passed: boolean
  /** `undefined` when the colour already passed and was left exactly as asked for. */
  readonly adjustment?: { readonly from: number; readonly to: number; readonly delta: number }
}

const DEFAULT_STEP = 0.5

const walk = (
  colour: Colour,
  predicate: (candidate: Colour) => boolean,
  sign: number,
  step: number,
  minimum: number,
  maximum: number,
): Colour | undefined => {
  const limit = sign < 0 ? minimum : maximum
  const steps = Math.ceil(Math.abs(limit - colour.lightness) / step)
  for (let index = 1; index <= steps; index += 1) {
    const lightness = Math.min(Math.max(colour.lightness + sign * step * index, minimum), maximum)
    const candidate = withLightness(colour, lightness)
    if (predicate(candidate)) return candidate
  }
  return undefined
}

/**
 * Move lightness in small steps, keeping hue and chroma, until `predicate`
 * passes. This is the "nudge the accent until it passes" of ADR-028: the
 * tenant's hue survives, and the adjustment is reported rather than hidden.
 *
 * `auto` tries both directions and keeps the smaller change, so a colour is
 * never darkened past readable when lightening it would have done.
 */
export const nudgeLightnessUntil = (
  colour: Colour,
  predicate: (candidate: Colour) => boolean,
  options: NudgeOptions = {},
): NudgeResult => {
  if (predicate(colour)) return { colour, passed: true }

  const step = options.step ?? DEFAULT_STEP
  const minimum = options.minimum ?? 0
  const maximum = options.maximum ?? 100
  const direction = options.direction ?? 'auto'

  const darker =
    direction === 'lighter' ? undefined : walk(colour, predicate, -1, step, minimum, maximum)
  const lighter =
    direction === 'darker' ? undefined : walk(colour, predicate, 1, step, minimum, maximum)

  const found = [darker, lighter]
    .filter((candidate) => candidate !== undefined)
    .reduce<Colour | undefined>(
      (best, candidate) =>
        best === undefined ||
        Math.abs(candidate.lightness - colour.lightness) <
          Math.abs(best.lightness - colour.lightness)
          ? candidate
          : best,
      undefined,
    )

  if (found === undefined) return { colour, passed: false }
  return {
    colour: found,
    passed: true,
    adjustment: {
      from: colour.lightness,
      to: found.lightness,
      delta: found.lightness - colour.lightness,
    },
  }
}
