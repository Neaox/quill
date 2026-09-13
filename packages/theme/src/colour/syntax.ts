import { apcaLc } from '../contrast/apca.ts'
import { CONTRAST_FLOORS } from '../contrast/floors.ts'
import { contrastRatio } from '../contrast/wcag.ts'
import type { SyntaxFamily } from '../tokens.ts'
import type { Adjustment } from './adjustment.ts'
import { DARK_CHROMA_REDUCTION, type Scheme } from './bands.ts'
import { NO_CEILING, settleContrast, type ChromaCeiling, type Derived } from './derive.ts'
import type { Colour } from './oklch.ts'

export type SyntaxColours = {
  readonly colours: Readonly<Record<SyntaxFamily, Colour>>
  readonly adjustments: readonly Adjustment[]
}

/**
 * ADR-030: token hues are fixed, and only lightness follows the scheme. The
 * two quiet families take the theme's own tone so punctuation and comments
 * recede into the page rather than sitting on it.
 */
type FamilySpec = {
  readonly hue: number | 'tone' | 'success' | 'danger'
  readonly chroma: number
  readonly lightness: Record<Scheme, number>
}

const SPECS: Record<SyntaxFamily, FamilySpec> = {
  punctuation: { hue: 'tone', chroma: 0.02, lightness: { light: 45, dark: 68 } },
  comment: { hue: 'tone', chroma: 0.015, lightness: { light: 52, dark: 62 } },
  keyword: { hue: 300, chroma: 0.13, lightness: { light: 45, dark: 74 } },
  number: { hue: 60, chroma: 0.13, lightness: { light: 45, dark: 74 } },
  string: { hue: 150, chroma: 0.13, lightness: { light: 45, dark: 74 } },
  function: { hue: 265, chroma: 0.13, lightness: { light: 45, dark: 74 } },
  variable: { hue: 210, chroma: 0.13, lightness: { light: 45, dark: 74 } },
  regex: { hue: 25, chroma: 0.13, lightness: { light: 45, dark: 74 } },
  inserted: { hue: 'success', chroma: 0.13, lightness: { light: 45, dark: 74 } },
  deleted: { hue: 'danger', chroma: 0.13, lightness: { light: 45, dark: 74 } },
}

export type SyntaxHues = {
  readonly tone: number
  readonly success: number
  readonly danger: number
}

const hueOf = (spec: FamilySpec, hues: SyntaxHues): number =>
  typeof spec.hue === 'number' ? spec.hue : hues[spec.hue]

export const buildSyntaxColours = (
  hues: SyntaxHues,
  scheme: Scheme,
  codeBackground: Colour,
  cap: ChromaCeiling<SyntaxFamily> = NO_CEILING,
): SyntaxColours => {
  const adjustments: Adjustment[] = []
  const take = (derived: Derived): Colour => {
    adjustments.push(...derived.adjustments)
    return derived.colour
  }

  const build = (family: SyntaxFamily): Colour => {
    const spec = SPECS[family]
    const scaled =
      scheme === 'dark' ? spec.chroma * (1 - DARK_CHROMA_REDUCTION.chosen) : spec.chroma
    const chroma = Math.min(scaled, cap(family))
    return take(
      settleContrast(
        `token-${family}`,
        { lightness: spec.lightness[scheme], chroma, hue: hueOf(spec, hues) },
        (candidate) =>
          contrastRatio(candidate, codeBackground) >= CONTRAST_FLOORS.secondary.ratio &&
          apcaLc(candidate, codeBackground) >= CONTRAST_FLOORS.secondary.lc,
      ),
    )
  }

  return {
    colours: {
      punctuation: build('punctuation'),
      comment: build('comment'),
      keyword: build('keyword'),
      number: build('number'),
      string: build('string'),
      function: build('function'),
      variable: build('variable'),
      regex: build('regex'),
      inserted: build('inserted'),
      deleted: build('deleted'),
    },
    adjustments,
  }
}
