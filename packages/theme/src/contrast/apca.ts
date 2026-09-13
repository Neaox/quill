/* oxlint-disable typescript/triple-slash-reference -- `../apca-w3.d.ts` is an
   ambient `declare module` with no import or export of its own, so there is
   nothing for an ES import to name; a triple-slash reference is the
   documented way to pull an ambient declaration file into any program that
   reaches this module, which is what lets consumers drop their own copy of
   the `include` entry (see apca-w3.d.ts). */
/// <reference path="../apca-w3.d.ts" />
import { APCAcontrast, sRGBtoY } from 'apca-w3'
import { toRgb, type Colour } from '../colour/oklch.ts'

const channel = (value: number): number => Math.round(Math.min(Math.max(value, 0), 1) * 255)

const luminance = (colour: Colour): number => {
  const { r, g, b } = toRgb(colour)
  return sRGBtoY([channel(r), channel(g), channel(b)])
}

/**
 * APCA lightness contrast, signed: positive for dark text on light paper,
 * negative for light text on dark paper.
 */
export const apcaContrast = (text: Colour, background: Colour): number =>
  APCAcontrast(luminance(text), luminance(background))

/** The magnitude, which is what every floor in the colour rules is stated as. */
export const apcaLc = (text: Colour, background: Colour): number =>
  Math.abs(apcaContrast(text, background))
