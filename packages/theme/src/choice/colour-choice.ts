import { hueDistance } from '../colour/hue.ts'
import { mapIntoGamut, type Colour } from '../colour/oklch.ts'
import { SEED_CHROMA_MAX, type AccentSeedValue } from '../schema/theme-document.ts'

/**
 * A colour as a person chooses it for an identity: an accent, a label, a
 * collection. It is the accent seed's shape, because the accent is the
 * richest of them; a caller whose seed has no lightness simply ignores it.
 *
 * Every way of choosing one — a curated swatch, a brand colour, two sliders,
 * a few words — produces this, so a picker can offer them side by side and
 * switching between them never loses the choice.
 */
export type ColourChoice = AccentSeedValue

type Named<Id extends string> = { readonly id: Id; readonly name: string }

const nearest = <Entry>(entries: readonly Entry[], distance: (entry: Entry) => number): Entry =>
  entries.reduce((best, entry) => (distance(entry) < distance(best) ? entry : best))

/**
 * The colour families a hue is described by, in words a person uses rather
 * than degrees. Each family is a point on the hue circle, and a hue belongs
 * to the nearest one, so every hue has a name.
 */
export const COLOUR_FAMILIES = [
  { id: 'red', name: 'Red', hue: 25 },
  { id: 'amber', name: 'Amber', hue: 70 },
  { id: 'green', name: 'Green', hue: 145 },
  { id: 'teal', name: 'Teal', hue: 190 },
  { id: 'blue', name: 'Blue', hue: 255 },
  { id: 'purple', name: 'Purple', hue: 300 },
  { id: 'pink', name: 'Pink', hue: 350 },
] as const satisfies readonly (Named<string> & { readonly hue: number })[]

export type ColourFamily = (typeof COLOUR_FAMILIES)[number]

export const familyOf = (hue: number): ColourFamily =>
  nearest(COLOUR_FAMILIES, (family) => hueDistance(family.hue, hue))

/**
 * How strong an accent is, in three words. The values sit inside the band the
 * generator lets an accent carry in small areas (`CHROMA_BUDGET`), so each
 * word is a visible step rather than a clamp the generator undoes.
 */
export const INTENSITIES = [
  { id: 'quiet', name: 'Quiet', chroma: 0.09 },
  { id: 'balanced', name: 'Balanced', chroma: 0.13 },
  { id: 'bold', name: 'Bold', chroma: 0.18 },
] as const satisfies readonly (Named<string> & { readonly chroma: number })[]

export type Intensity = (typeof INTENSITIES)[number]

export const intensityOf = (chroma: number): Intensity =>
  nearest(INTENSITIES, (intensity) => Math.abs(intensity.chroma - chroma))

/** The lightness a choice is painted at on a control when it states none: the light accent's. */
const PAINTED_LIGHTNESS = 55

/**
 * The colour a control paints for a choice — a swatch, a colour well, a
 * slider's thumb — brought into sRGB by chroma alone, so what is painted is
 * the hue that was chosen.
 */
export const paintedColour = (choice: Pick<ColourChoice, 'hue' | 'chroma' | 'lightness'>): Colour =>
  mapIntoGamut({
    lightness: choice.lightness ?? PAINTED_LIGHTNESS,
    chroma: choice.chroma,
    hue: choice.hue,
  }).colour

const round = (value: number, places: number): number => Number(value.toFixed(places))

/**
 * A colour taken as it is — a brand colour — as a choice. The hue is kept,
 * the chroma is held to the schema's ceiling, and the exact lightness is kept
 * for the mark; the generator still moves links
 * and buttons to wherever the contrast floors need them. Rounded finely
 * enough that an 8-bit brand colour comes back as the same hex and no finer,
 * so a saved document reads `hue: 184.01` rather than `hue: 184.00974071530118`.
 */
export const choiceOfColour = (colour: Colour): ColourChoice => ({
  // culori's hues are 0 to 360, so a remainder is enough to fold 360 onto 0.
  hue: round(colour.hue, 2) % 360,
  chroma: round(Math.min(colour.chroma, SEED_CHROMA_MAX.accent), 4),
  lightness: round(colour.lightness, 2),
})
