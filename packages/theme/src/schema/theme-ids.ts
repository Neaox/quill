/**
 * The built-in theme ids, as plain data with no imports, so the `./builtin`
 * entry can resolve an id without reaching the schema validator (review
 * 2026-09-13, H1).
 */

/**
 * Every id a theme document may name as a built-in: the ones offered today,
 * and the ones that were offered once and have been superseded. A saved fork
 * records its `base`, so an id never leaves this list (AGENTS.md rule 17);
 * a superseded id resolves to its successor instead (`builtin/themes.ts`).
 */
export const BUILTIN_THEME_IDS = [
  'instrument',
  'calm',
  'editorial',
  'grid',
  'atelier',
  'press',
] as const
export type BuiltinThemeId = (typeof BUILTIN_THEME_IDS)[number]

/** The built-ins a chooser offers, in the order it offers them. */
export const OFFERED_THEME_IDS = [
  'instrument',
  'calm',
  'editorial',
  'grid',
  'atelier',
] as const satisfies readonly BuiltinThemeId[]
export type OfferedThemeId = (typeof OFFERED_THEME_IDS)[number]

/** A built-in that is no longer offered, and the one that replaced it. */
export const SUPERSEDED_THEMES = {
  press: 'editorial',
} as const satisfies Record<Exclude<BuiltinThemeId, OfferedThemeId>, OfferedThemeId>
