import { CHROMA_BUDGET } from '../colour/bands.ts'
import { parseColour, type Colour } from '../colour/oklch.ts'
import type { AccentSeedValue, ToneSeedValue } from '../schema/theme-document.ts'

export type ExtractedSeeds = {
  readonly accent: AccentSeedValue
  readonly tone: ToneSeedValue
  /** The colours that were understood, most chromatic first. */
  readonly candidates: readonly Colour[]
  /** True when the accent's own lightness is safe for text as well as for a mark. */
  readonly accentIsTextSafe: boolean
}

const TEXT_SAFE_LIGHTNESS = { low: 30, high: 60 } as const

const DEFAULT_ACCENT: AccentSeedValue = { hue: 45, chroma: 0.16, lightness: 55 }
const DEFAULT_TONE: ToneSeedValue = { hue: 250, chroma: 0.004 }

/**
 * ADR-028, onboarding step 1: the most chromatic brand colour becomes the
 * accent candidate, and the warmth of the brand's neutrals sets the tone.
 * An accent that is too light for text keeps its exact value for the mark.
 */
export const extractSeedsFromColours = (hexes: readonly string[]): ExtractedSeeds => {
  const candidates = hexes
    .map((hex) => parseColour(hex))
    .filter((colour) => colour !== undefined)
    .toSorted((first, second) => second.chroma - first.chroma)

  const [mostChromatic] = candidates
  if (mostChromatic === undefined) {
    return { accent: DEFAULT_ACCENT, tone: DEFAULT_TONE, candidates, accentIsTextSafe: false }
  }

  const neutrals = candidates.filter((colour) => colour.chroma < CHROMA_BUDGET.saturatedThreshold)
  const warmth = neutrals.at(0) ?? mostChromatic

  return {
    accent: {
      hue: mostChromatic.hue,
      chroma: mostChromatic.chroma,
      lightness: mostChromatic.lightness,
    },
    tone: {
      hue: warmth.hue,
      chroma: Math.min(
        Math.max(warmth.chroma, CHROMA_BUDGET.paperTintMinimum),
        CHROMA_BUDGET.paper,
      ),
    },
    candidates,
    accentIsTextSafe:
      mostChromatic.lightness >= TEXT_SAFE_LIGHTNESS.low &&
      mostChromatic.lightness <= TEXT_SAFE_LIGHTNESS.high,
  }
}
