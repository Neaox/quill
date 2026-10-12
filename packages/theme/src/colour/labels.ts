import { apcaLc } from '../contrast/apca.ts'
import { CONTRAST_FLOORS } from '../contrast/floors.ts'
import { contrastRatio } from '../contrast/wcag.ts'
import { DEFAULT_LABEL_CHROMA } from '../schema/labels.ts'
import type { LabelSeedValue } from '../schema/theme-document.ts'
import type { Adjustment } from './adjustment.ts'
import { DARK_CHROMA_REDUCTION, type Scheme } from './bands.ts'
import { settleContrast, type Derived } from './derive.ts'
import { compensateChroma } from './hue.ts'
import type { Colour } from './oklch.ts'
import { buildTint } from './tint.ts'

/**
 * A tenant label's colours in one scheme (ADR-037):
 *
 * - `ink`, the label's text — a pill's words, a drawing's text — held to the
 *   secondary floor on every surface a document sits on, as a status is;
 * - `fill`, the pill's background, a tint of the ink that keeps the ink and
 *   the page's own ink readable on it;
 * - `stroke`, a drawing's lines and outlines, a little brighter than the
 *   ink and held to the non-text floor on a drawing's raised surface.
 */
export type LabelColours = {
  readonly name: string
  readonly ink: Colour
  readonly fill: Colour
  readonly stroke: Colour
}

export type LabelSet = {
  readonly labels: readonly LabelColours[]
  readonly adjustments: readonly Adjustment[]
}

/** The status set's lightness (`status.ts`), so a label sits beside a badge as an equal. */
const INK_LIGHTNESS: Record<Scheme, number> = { light: 48, dark: 72 }

/** A line is thinner than a letter is tall, so it starts nearer the middle and keeps more colour. */
const STROKE_LIGHTNESS: Record<Scheme, number> = { light: 56, dark: 66 }

type LabelNeutrals = {
  readonly paper: Colour
  readonly surface: Colour
  readonly raised: Colour
  readonly ink: Colour
}

/** Every surface a document's text sits on. */
const surfacesOf = (neutral: LabelNeutrals): readonly Colour[] => [
  neutral.paper,
  neutral.surface,
  neutral.raised,
]

export const buildLabelColours = (
  seeds: readonly LabelSeedValue[],
  scheme: Scheme,
  neutral: LabelNeutrals,
): LabelSet => {
  const adjustments: Adjustment[] = []
  const take = (derived: Derived): Colour => {
    adjustments.push(...derived.adjustments)
    return derived.colour
  }

  const build = (seed: LabelSeedValue): LabelColours => {
    const compensated = compensateChroma(seed.chroma ?? DEFAULT_LABEL_CHROMA, seed.hue)
    const chroma =
      scheme === 'dark' ? compensated * (1 - DARK_CHROMA_REDUCTION.chosen) : compensated
    const role = `label ${seed.name}`

    const ink = take(
      settleContrast(
        role,
        { lightness: INK_LIGHTNESS[scheme], chroma, hue: seed.hue },
        (candidate) => {
          const floor = CONTRAST_FLOORS.secondary
          return (
            surfacesOf(neutral).every(
              (surface) => contrastRatio(candidate, surface) >= floor.ratio,
            ) && apcaLc(candidate, neutral.paper) >= floor.lc
          )
        },
      ),
    )
    const stroke = take(
      settleContrast(
        `${role} stroke`,
        { lightness: STROKE_LIGHTNESS[scheme], chroma, hue: seed.hue },
        (candidate) => {
          const floor = CONTRAST_FLOORS.nonText
          return surfacesOf(neutral).every(
            (surface) =>
              contrastRatio(candidate, surface) >= floor.ratio &&
              apcaLc(candidate, surface) >= floor.lc,
          )
        },
      ),
    )
    const fill = take(buildTint(`${role} fill`, ink, scheme, neutral))
    return { name: seed.name, ink, fill, stroke }
  }

  return { labels: seeds.map(build), adjustments }
}
