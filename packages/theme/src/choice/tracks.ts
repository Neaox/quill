import { formatOklch } from '../colour/oklch.ts'
import { paintedColour, type ColourChoice } from './colour-choice.ts'

/**
 * The colours a slider's track shows, so moving the thumb is choosing a colour
 * you can see rather than a number: every hue at the current strength, and
 * every strength at the current hue. Each stop is painted the way a swatch is,
 * brought into sRGB by chroma alone, so the track never shows a colour the
 * choice could not be.
 */

const HUE_STOPS = 12
const CHROMA_STOPS = 6

const gradient = (stops: readonly ColourChoice[]): string =>
  `linear-gradient(to right, ${stops.map((stop) => formatOklch(paintedColour(stop))).join(', ')})`

/** Round the wheel from 0 to 360 degrees, at the choice's chroma and lightness. */
export const hueTrack = (choice: ColourChoice): string =>
  gradient(
    Array.from({ length: HUE_STOPS + 1 }, (_, stop) => ({
      ...choice,
      hue: (stop * 360) / HUE_STOPS,
    })),
  )

/** From grey to `maximum`, at the choice's hue and lightness. */
export const chromaTrack = (choice: ColourChoice, maximum: number): string =>
  gradient(
    Array.from({ length: CHROMA_STOPS + 1 }, (_, stop) => ({
      ...choice,
      chroma: (stop * maximum) / CHROMA_STOPS,
    })),
  )
