import { err, ok, type Result } from '@quill/domain'

import { mapIntoGamut, parseColour, type Colour } from '../colour/oklch.ts'

/**
 * Reading a colour the way a brand guide writes it.
 *
 * A **strategy registry**: each format says whether an input is written in it
 * and how to read it, and `readColour` asks them in order. The first format
 * that claims the input owns it, so an input that looks like HSL but is not
 * valid HSL is reported as bad HSL rather than as an unknown colour.
 *
 * Every CSS syntax is read by culori, which the generator already depends on
 * and which implements CSS Color 4: modern space-separated and legacy comma
 * syntax, `deg`, `turn`, `rad` and `grad` hue units, percentages, alpha, and
 * the named colours. Only the two shapes CSS has no syntax for are owned here:
 * a bare `R, G, B` triple, and CMYK for brand guides that give only print
 * values. Pantone is a licensed library with no public conversion, so it is
 * deliberately not a format.
 */

export const COLOUR_FORMAT_IDS = [
  'hex',
  'rgb',
  'hsl',
  'hwb',
  'oklch',
  'oklab',
  'lab',
  'lch',
  'cmyk',
  'triple',
  'named',
] as const

export type ColourFormat = (typeof COLOUR_FORMAT_IDS)[number]

interface ColourFormatReader {
  readonly format: ColourFormat
  /** True when the input is written in this format, valid or not. */
  readonly claims: (input: string) => boolean
  readonly read: (input: string) => Colour | undefined
}

export type ReadColour = {
  readonly colour: Colour
  readonly format: ColourFormat
  /**
   * True when the colour was outside sRGB and its chroma was reduced to bring
   * it in. Hue and lightness are kept; only the strength gave way.
   */
  readonly broughtIntoGamut: boolean
}

export type ColourReadError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'unrecognised' }
  | { readonly kind: 'invalid'; readonly format: ColourFormat }

const BYTE_MAX = 255
const PERCENT = 100
/** Below this, a reduction is the round trip through OKLCH, not a colour outside sRGB. */
const GAMUT_NOISE = 1e-4

const byFunction =
  (...names: readonly string[]) =>
  (input: string): boolean =>
    names.some((name) => input.startsWith(`${name}(`))

const cssReader = (
  format: ColourFormat,
  claims: (input: string) => boolean,
): ColourFormatReader => ({
  format,
  claims,
  read: parseColour,
})

/** `15, 138, 126` or `15 138 126`: three bytes, as a design tool's RGB fields give them. */
const TRIPLE = /^(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})$/u

const readTriple = (input: string): Colour | undefined => {
  const bytes = TRIPLE.exec(input)?.slice(1).map(Number)
  if (bytes === undefined || bytes.some((byte) => byte > BYTE_MAX)) return undefined
  return parseColour(`rgb(${bytes.join(' ')})`)
}

/** `cmyk(10%, 20%, 30%, 0%)`; the percent signs are optional, the commas may be spaces. */
const CMYK =
  /^cmyk\(\s*([\d.]+)%?(?:\s*,\s*|\s+)([\d.]+)%?(?:\s*,\s*|\s+)([\d.]+)%?(?:\s*,\s*|\s+)([\d.]+)%?\s*\)$/u

/**
 * The textbook conversion, with no ICC profile: ink is subtracted from white
 * and black scales the rest. A press converts through the profile of its
 * paper and inks, so this lands near the printed colour rather than on it,
 * which is close enough to seed an accent the generator then tunes anyway.
 */
const readCmyk = (input: string): Colour | undefined => {
  const inks = CMYK.exec(input)
    ?.slice(1)
    .map((value) => Number(value) / PERCENT)
  if (inks === undefined || inks.some((ink) => Number.isNaN(ink) || ink > 1)) return undefined
  const [cyan = 0, magenta = 0, yellow = 0, black = 0] = inks
  const channel = (ink: number) => Math.round(BYTE_MAX * (1 - ink) * (1 - black))
  return parseColour(`rgb(${channel(cyan)} ${channel(magenta)} ${channel(yellow)})`)
}

const COLOUR_FORMAT_READERS: readonly ColourFormatReader[] = [
  cssReader('hex', (input) => input.startsWith('#')),
  cssReader('rgb', byFunction('rgb', 'rgba')),
  cssReader('hsl', byFunction('hsl', 'hsla')),
  cssReader('hwb', byFunction('hwb')),
  cssReader('oklch', byFunction('oklch')),
  cssReader('oklab', byFunction('oklab')),
  cssReader('lab', byFunction('lab')),
  cssReader('lch', byFunction('lch')),
  { format: 'cmyk', claims: byFunction('cmyk'), read: readCmyk },
  { format: 'triple', claims: (input) => /^\d/u.test(input), read: readTriple },
  cssReader('named', (input) => /^[a-z]+$/u.test(input)),
]

/**
 * Read a colour in any format a brand guide is likely to give, into sRGB.
 * Alpha is dropped: an accent is opaque.
 */
export const readColour = (input: string): Result<ReadColour, ColourReadError> => {
  // CSS is case-insensitive throughout, and so is every format here.
  const normalised = input.trim().toLowerCase()
  if (normalised === '') return err({ kind: 'empty' })

  const reader = COLOUR_FORMAT_READERS.find((candidate) => candidate.claims(normalised))
  if (reader === undefined) return err({ kind: 'unrecognised' })

  const parsed = reader.read(normalised)
  if (parsed === undefined) return err({ kind: 'invalid', format: reader.format })

  const { colour, chromaReducedBy } = mapIntoGamut({
    lightness: parsed.lightness,
    chroma: parsed.chroma,
    hue: parsed.hue,
  })
  return ok({ colour, format: reader.format, broughtIntoGamut: chromaReducedBy > GAMUT_NOISE })
}
