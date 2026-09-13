import type { BuiltinThemeId, ThemeDocument } from '../schema/theme-document.ts'
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
