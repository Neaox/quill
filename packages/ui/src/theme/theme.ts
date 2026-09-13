/**
 * Theme preference: the three states a theme control has to offer.
 *
 * `system` is not "light" — it is "follow the operating system", and it is the
 * default, because most people have already made that choice once.
 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** The two themes a preference can resolve to. */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

/** Where the preference is remembered. */
export const THEME_STORAGE_KEY = 'theme-preference'

/** The attribute the stylesheet reads. Absent means "follow the system". */
export const THEME_ATTRIBUTE = 'data-theme'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** Resolves a preference against the current operating system setting. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

/**
 * Writes the preference onto an element, usually `document.documentElement`.
 *
 * `system` removes the attribute rather than writing a resolved value, so the
 * `prefers-color-scheme` rules stay in charge and a change to the operating
 * system setting is picked up without JavaScript running again.
 */
export function applyThemePreference(element: Element, preference: ThemePreference): void {
  if (preference === 'system') {
    element.removeAttribute(THEME_ATTRIBUTE)
    return
  }
  element.setAttribute(THEME_ATTRIBUTE, preference)
}

/** The subset of `Storage` the theme needs. */
export interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Reads the remembered preference, falling back to `system`.
 *
 * Storage throws rather than returning null in a browser configured to block
 * site data, so every access is guarded: a theme control must not be able to
 * break a page.
 */
export function readThemePreference(storage: ThemeStorage): ThemePreference {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

/** Remembers the preference, ignoring a storage that refuses to be written. */
export function writeThemePreference(storage: ThemeStorage, preference: ThemePreference): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // A preference that cannot be remembered still applies to this page.
  }
}
