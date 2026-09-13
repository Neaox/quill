import { wcagContrast } from 'culori'
import { toCulori, type Colour } from '../colour/oklch.ts'

/**
 * WCAG 2.2 contrast ratio, 1 to 21. Computed through sRGB, so a wide-gamut
 * display only ever does better than the number reported here.
 */
export const contrastRatio = (a: Colour, b: Colour): number =>
  wcagContrast(toCulori(a), toCulori(b))
