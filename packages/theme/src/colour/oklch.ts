import { clampChroma, converter, inGamut, type Oklab, type Oklch, type Rgb } from 'culori'

/**
 * A colour in OKLCH, expressed in the units `docs/design/colour-rules.md` is
 * written in: lightness 0 to 100, chroma 0 to roughly 0.37, hue in degrees.
 *
 * The rules quote lightness as a percentage everywhere, so the engine works in
 * percentages too and converts at the culori boundary rather than asking every
 * call site to remember which scale it is on.
 */
export type Colour = {
  readonly lightness: number
  readonly chroma: number
  readonly hue: number
  readonly alpha?: number | undefined
}

const toOklchColour = converter('oklch')
const toRgbColour = converter('rgb')
const toOklabColour = converter('oklab')
const rgbInGamut = inGamut('rgb')

export const toCulori = (colour: Colour): Oklch => ({
  mode: 'oklch',
  l: colour.lightness / 100,
  c: colour.chroma,
  h: colour.hue,
  ...(colour.alpha === undefined ? {} : { alpha: colour.alpha }),
})

export const fromCulori = (colour: Oklch): Colour => ({
  lightness: colour.l * 100,
  chroma: colour.c,
  hue: colour.h ?? 0,
  ...(colour.alpha === undefined ? {} : { alpha: colour.alpha }),
})

export const parseColour = (css: string): Colour | undefined => {
  const parsed = toOklchColour(css)
  return parsed === undefined ? undefined : fromCulori(parsed)
}

export const toRgb = (colour: Colour): Rgb => toRgbColour(toCulori(colour))

export const toOklab = (colour: Colour): Oklab => toOklabColour(toCulori(colour))

export const isInGamut = (colour: Colour): boolean => rgbInGamut(toCulori(colour))

/**
 * Gamut mapping by chroma reduction, never clipping (colour rules, section 2):
 * lightness and hue survive, chroma is the only thing that gives way.
 */
export const mapIntoGamut = (colour: Colour): { colour: Colour; chromaReducedBy: number } => {
  if (isInGamut(colour)) return { colour, chromaReducedBy: 0 }
  const clamped = fromCulori(clampChroma(toCulori(colour), 'oklch'))
  return {
    colour: { ...colour, chroma: clamped.chroma },
    chromaReducedBy: colour.chroma - clamped.chroma,
  }
}

export const withLightness = (colour: Colour, lightness: number): Colour => ({
  ...colour,
  lightness,
})

export const withChroma = (colour: Colour, chroma: number): Colour => ({ ...colour, chroma })

export const withAlpha = (colour: Colour, alpha: number): Colour => ({ ...colour, alpha })

/**
 * Mix `amount` of `colour` into `background`, interpolated in OKLab so the
 * result keeps a perceptually even path rather than swinging through a hue.
 */
export const mix = (colour: Colour, background: Colour, amount: number): Colour => {
  const a = toOklab(colour)
  const b = toOklab(background)
  const blended: Oklab = {
    mode: 'oklab',
    l: b.l + (a.l - b.l) * amount,
    a: b.a + (a.a - b.a) * amount,
    b: b.b + (a.b - b.b) * amount,
  }
  return fromCulori(toOklchColour(blended))
}

const round = (value: number, places: number): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** Serialise for CSS, at the precision the hand-written token file uses. */
export const formatOklch = (colour: Colour): string => {
  const lightness = round(colour.lightness, 2)
  const chroma = round(colour.chroma, 4)
  const hue = round(colour.hue, 1)
  const base = `oklch(${lightness}% ${chroma} ${hue}`
  return colour.alpha === undefined || colour.alpha >= 1
    ? `${base})`
    : `${base} / ${round(colour.alpha * 100, 1)}%)`
}
