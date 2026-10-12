import { BUILTIN_THEME_IDS, type BuiltinThemeId } from '@quill/theme'

import type { ThemeSettings } from '../../lib/api/index.ts'

/**
 * Editing the organisation's theme document, shared by the two screens that
 * write it: Theme (the levers) and Labels and emoji (the theme's labels,
 * ADR-037). Both change the same document, so both fork a built-in the same
 * way and drop an empty optional set the same way.
 */

/** The id a fork takes, so an edited theme never claims to be the built-in it came from. */
export const FORK_ID = 'organisation-theme'
export const FORK_NAME = 'Custom theme'

export function isBuiltinThemeId(id: string): id is BuiltinThemeId {
  return BUILTIN_THEME_IDS.some((candidate) => candidate === id)
}

/**
 * ADR-028's onboarding step 4: "saving creates the tenant's theme as a fork of
 * the chosen built-in, so it can be re-opened and adjusted later, or reset to
 * the base".
 *
 * A new instance starts on the built-in document itself, so the first change
 * anybody makes forks it — same values, a new identity, and `base` recorded
 * so "reset to Instrument" still means something. Doing it on the first
 * change rather than behind a "make a copy" button keeps the fork an
 * implementation detail of editing, which is what it is.
 *
 * The fork keeps the values of the document the organisation *saved*, not
 * the built-in as it ships today: a built-in may be refined or superseded
 * after an organisation chose it (Press became Editorial), and one change
 * must not quietly replace every other value with the new ones
 * (AGENTS.md rule 17).
 */
export function forkedIfBuiltin(theme: ThemeSettings): ThemeSettings {
  if (theme.base !== undefined || !isBuiltinThemeId(theme.id)) return theme
  return { ...theme, id: FORK_ID, name: FORK_NAME, base: theme.id }
}

/**
 * Sets one of the theme's optional sets — collection colours, labels — or
 * drops it entirely rather than writing an empty one the schema has no use for.
 */
export function withOptional<Key extends 'collections' | 'labels'>(
  theme: ThemeSettings,
  key: Key,
  value: NonNullable<ThemeSettings[Key]> | undefined,
): ThemeSettings {
  const next = { ...theme }
  delete next[key]
  return value === undefined ? next : { ...next, [key]: value }
}
