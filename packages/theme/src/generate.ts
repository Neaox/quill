import { buildPalettes } from './colour/palette.ts'
import { reportOn, type ThemeReport } from './doctor/run.ts'
import type { DoctorOptions } from './doctor/rule.ts'
import { labelTokens, type GeneratedLabel } from './label-css.ts'
import type { ThemeDocument } from './schema/theme-document.ts'
import { toTokenMap } from './token-map.ts'
import type { TokenMap } from './tokens.ts'

export type GeneratedTheme = {
  readonly themeId: string
  readonly light: TokenMap
  readonly dark: TokenMap
  /** The organisation's labels (ADR-037), each settled in both schemes; empty without any. */
  readonly labels: readonly GeneratedLabel[]
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
    labels: (theme.labels ?? []).flatMap((seed, index) => {
      const light = palettes.light.labels[index]
      const dark = palettes.dark.labels[index]
      /* v8 ignore next -- both palettes build one entry per seed, in order. */
      if (light === undefined || dark === undefined) return []
      return [
        { name: seed.name, title: seed.title, light: labelTokens(light), dark: labelTokens(dark) },
      ]
    }),
    report: reportOn(theme, palettes, options),
  }
}
