import { nudgeLightnessUntil, type NudgeOptions } from '../contrast/nudge.ts'
import type { Adjustment } from './adjustment.ts'
import { mapIntoGamut, type Colour } from './oklch.ts'

/**
 * A ceiling on the chroma a role may carry, which is how the dark scheme is
 * re-derived from the light one: the ceiling is applied to the seed, before
 * contrast settling, so the colour the floors were checked against is the
 * colour that ships.
 */
export type ChromaCeiling<Role extends string = string> = (role: Role) => number

export const NO_CEILING: ChromaCeiling = () => Number.POSITIVE_INFINITY

export type Derived = {
  readonly colour: Colour
  readonly adjustments: readonly Adjustment[]
}

/** Bring a colour into sRGB by reducing chroma, recording what the display could not hold. */
export const settleGamut = (role: string, colour: Colour): Derived => {
  const { colour: mapped, chromaReducedBy } = mapIntoGamut(colour)
  return {
    colour: mapped,
    adjustments:
      chromaReducedBy === 0
        ? []
        : [
            {
              role,
              property: 'chroma',
              reason: 'gamut',
              from: colour.chroma,
              to: mapped.chroma,
            },
          ],
  }
}

/**
 * Move lightness until the predicate holds, then gamut-map. Both steps report,
 * so a colour that was lightened for contrast and then desaturated to fit the
 * display says so twice rather than once.
 */
export const settleContrast = (
  role: string,
  colour: Colour,
  predicate: (candidate: Colour) => boolean,
  options?: NudgeOptions,
): Derived => {
  const nudged = nudgeLightnessUntil(colour, predicate, options ?? {})
  const gamut = settleGamut(role, nudged.colour)
  const lightnessAdjustment: readonly Adjustment[] =
    nudged.adjustment === undefined
      ? []
      : [
          {
            role,
            property: 'lightness',
            reason: 'contrast',
            from: nudged.adjustment.from,
            to: nudged.adjustment.to,
          },
        ]
  return { colour: gamut.colour, adjustments: [...lightnessAdjustment, ...gamut.adjustments] }
}

/** Record a clamp the chroma budget or a lightness band imposed on a seed. */
export const recordClamp = (
  role: string,
  property: Adjustment['property'],
  reason: Adjustment['reason'],
  from: number,
  to: number,
): readonly Adjustment[] => (from === to ? [] : [{ role, property, reason, from, to }])
