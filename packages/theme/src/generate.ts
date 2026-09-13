import { buildPalettes } from './colour/palette.ts'
import { reportOn, type ThemeReport } from './doctor/run.ts'
import type { DoctorOptions } from './doctor/rule.ts'
import type { ThemeDocument } from './schema/theme-document.ts'
import { toTokenMap } from './token-map.ts'
import type { TokenMap } from './tokens.ts'

export type GeneratedTheme = {
  readonly themeId: string
  readonly light: TokenMap
  readonly dark: TokenMap
  readonly report: ThemeReport
}

/**
 * Resolve a theme document into the two token maps the product ships and the
 * doctor's report on them. Both palettes are generated once and shared with
 * the doctor, so the report describes exactly the colours that were emitted.
 */
export const generateTheme = (
  theme: ThemeDocument,
  options?: Partial<DoctorOptions>,
): GeneratedTheme => {
  const palettes = buildPalettes(theme)
  return {
    themeId: theme.id,
    light: toTokenMap(theme, palettes.light),
    dark: toTokenMap(theme, palettes.dark),
    report: reportOn(theme, palettes, options),
  }
}
