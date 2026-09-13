import { apcaLc } from '../contrast/apca.ts'
import { CONTRAST_FLOORS } from '../contrast/floors.ts'
import { contrastRatio } from '../contrast/wcag.ts'
import { ACCENT_TINT_MIX, CHROMA_BUDGET, type Scheme } from './bands.ts'
import { settleContrast, type Derived } from './derive.ts'
import { mix, withChroma, type Colour } from './oklch.ts'

/**
 * A subtle background tint: a mix of the source colour into the paper at the
 * 8 to 14 percent section 4 allows, capped at the panel chroma budget because
 * a tinted paper contributes chroma of its own, then moved until both the ink
 * and the source colour stay readable on it.
 */
export const buildTint = (
  role: string,
  source: Colour,
  scheme: Scheme,
  neutral: { readonly paper: Colour; readonly ink: Colour },
  ceiling = Number.POSITIVE_INFINITY,
): Derived => {
  const mixed = mix(source, neutral.paper, ACCENT_TINT_MIX[scheme])
  const budgeted = withChroma(mixed, Math.min(mixed.chroma, CHROMA_BUDGET.panel, ceiling))
  return settleContrast(role, budgeted, (candidate) => {
    const body = CONTRAST_FLOORS.body
    const secondary = CONTRAST_FLOORS.secondary
    return (
      contrastRatio(neutral.ink, candidate) >= body.ratio &&
      apcaLc(neutral.ink, candidate) >= body.lc &&
      contrastRatio(source, candidate) >= secondary.ratio &&
      apcaLc(source, candidate) >= secondary.lc
    )
  })
}
