import { formatHex, formatHsl, formatRgb } from 'culori'

import { formatOklch, toCulori, type Colour } from '../colour/oklch.ts'

/**
 * The formats a chosen colour is written back out in, so it can be taken to a
 * brand guide or a design tool. Hex, RGB and HSL are sRGB and are written by
 * culori; OKLCH is the engine's own notation.
 */
export const COLOUR_WRITE_FORMATS = ['hex', 'rgb', 'hsl', 'oklch'] as const

export type ColourWriteFormat = (typeof COLOUR_WRITE_FORMATS)[number]

const WRITERS: Readonly<Record<ColourWriteFormat, (colour: Colour) => string>> = {
  hex: (colour) => formatHex(toCulori(colour)),
  rgb: (colour) => formatRgb(toCulori(colour)),
  hsl: (colour) => formatHsl(toCulori(colour)),
  oklch: formatOklch,
}

export const writeColour = (colour: Colour, format: ColourWriteFormat): string =>
  WRITERS[format](colour)
