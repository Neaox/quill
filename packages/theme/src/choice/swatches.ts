import type { ColourChoice } from './colour-choice.ts'

export type AccentSwatch = {
  readonly id: string
  readonly name: string
  readonly hue: number
  readonly chroma: number
}

/**
 * The curated accents, in hue order round the wheel: a hue and a chroma each,
 * chosen so that none of them adds a doctor's warning, in light or dark, to
 * any offered built-in (`swatches.test.ts` holds them to it). A swatch states no lightness, so the
 * generator places it in the accent band and settles it against the contrast
 * floors, which is what "already tuned" means here.
 */
export const ACCENT_SWATCHES = [
  { id: 'rose', name: 'Rose', hue: 5, chroma: 0.15 },
  { id: 'coral', name: 'Coral', hue: 40, chroma: 0.15 },
  { id: 'amber', name: 'Amber', hue: 70, chroma: 0.13 },
  { id: 'olive', name: 'Olive', hue: 115, chroma: 0.1 },
  { id: 'green', name: 'Green', hue: 150, chroma: 0.13 },
  { id: 'teal', name: 'Teal', hue: 185, chroma: 0.1 },
  { id: 'ocean', name: 'Ocean', hue: 220, chroma: 0.11 },
  { id: 'sky', name: 'Sky', hue: 242, chroma: 0.14 },
  { id: 'slate', name: 'Slate', hue: 255, chroma: 0.08 },
  { id: 'indigo', name: 'Indigo', hue: 275, chroma: 0.15 },
  { id: 'violet', name: 'Violet', hue: 300, chroma: 0.14 },
  { id: 'plum', name: 'Plum', hue: 335, chroma: 0.12 },
] as const satisfies readonly AccentSwatch[]

const SAME = 1e-6

/**
 * The swatch a choice is, if it is one: the same hue and chroma, and no
 * lightness of its own. A brand colour with a swatch's hue is still the
 * brand's colour, not the swatch.
 */
export const swatchMatching = (choice: ColourChoice): AccentSwatch | undefined =>
  choice.lightness === undefined && choice.darkLightness === undefined
    ? ACCENT_SWATCHES.find(
        (swatch) =>
          Math.abs(swatch.hue - choice.hue) < SAME &&
          Math.abs(swatch.chroma - choice.chroma) < SAME,
      )
    : undefined

/** A swatch as a choice: the whole accent, replacing any lightness the previous one carried. */
export const choiceOfSwatch = (swatch: AccentSwatch): ColourChoice => ({
  hue: swatch.hue,
  chroma: swatch.chroma,
})
