import type { Colour } from '../colour/oklch.ts'
import { apcaLc } from './apca.ts'
import { contrastRatio } from './wcag.ts'

export type TextChoice = {
  readonly colour: Colour
  readonly ratio: number
  readonly lc: number
}

/**
 * Section 1: text on the accent is "whichever of white or ink scores higher".
 * Ties break towards the earlier candidate so the caller's preference order is
 * meaningful.
 */
export const bestTextOn = (
  background: Colour,
  candidates: readonly [Colour, ...(readonly Colour[])],
): TextChoice => {
  const scored = candidates.map((colour) => ({
    colour,
    ratio: contrastRatio(colour, background),
    lc: apcaLc(colour, background),
  }))
  return scored.reduce((best, candidate) => (candidate.ratio > best.ratio ? candidate : best))
}
