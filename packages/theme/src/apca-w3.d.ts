/**
 * `apca-w3` ships no type declarations. Only the two functions this package
 * uses are declared, with the signatures documented in its README.
 */
declare module 'apca-w3' {
  /** Relative luminance for an 8-bit sRGB triple. */
  export function sRGBtoY(rgb: readonly [number, number, number]): number

  /**
   * Lightness contrast, signed: positive for dark text on a light background,
   * negative for light text on a dark background.
   */
  export function APCAcontrast(textY: number, backgroundY: number, places?: number): number
}
