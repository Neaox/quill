import type { BuiltinThemeId, ThemeDocument, ThemeVariants } from '../schema/theme-document.ts'
import { atelier } from './atelier.ts'
import { instrument } from './instrument.ts'
import { press } from './press.ts'

export const BUILTIN_THEMES: Readonly<Record<BuiltinThemeId, ThemeDocument>> = {
  press,
  instrument,
  atelier,
}

/**
 * ADR-028: Instrument is the default for a new instance, because it fits the
 * first users best and the design system is tuned on it first.
 */
export const DEFAULT_THEME: ThemeDocument = instrument

export const builtinTheme = (id: BuiltinThemeId): ThemeDocument => BUILTIN_THEMES[id]

/**
 * The layout a theme recommends (ADR-028's amendment).
 *
 * The theme document still spells this block `variants`, which is what every
 * built-in theme, the token map and the web shell read today. Renaming it to
 * `layout` is part of the same amendment and is deliberately not done here:
 * **this function is the one place that reads a theme's recommendation as a
 * layout**, so the rename is a change to this line rather than to every
 * caller — which only holds while every caller uses it. It lives on the
 * `./builtin` entry because it is pure data access, so the settings screens
 * and the server can share it without either reaching the validator.
 */
export const recommendedLayout = (theme: ThemeDocument): ThemeVariants => theme.variants
