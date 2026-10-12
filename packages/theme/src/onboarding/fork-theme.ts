import { BUILTIN_THEMES, successorOf } from '../builtin/themes.ts'
import type { BuiltinThemeId, ThemeDocument } from '../schema/theme-document.ts'

export type ThemeChanges = {
  readonly id: string
  readonly name: string
  readonly seeds?: Partial<ThemeDocument['seeds']>
  readonly type?: Partial<ThemeDocument['type']>
  readonly variants?: Partial<ThemeDocument['variants']>
  readonly shape?: Partial<ThemeDocument['shape']>
  readonly collections?: ThemeDocument['collections']
  readonly levers?: ThemeDocument['levers']
  readonly overrides?: ThemeDocument['overrides']
}

const merged = <T extends object>(base: T, changes: Partial<T> | undefined): T =>
  changes === undefined ? base : { ...base, ...changes }

/**
 * ADR-028, onboarding step 4: saving creates the tenant's theme as a fork of
 * the chosen built-in, recording `base` so it can be re-opened, adjusted, or
 * reset to what it started from. A superseded id forks its successor and
 * records the successor, so a new fork never starts life on a retired name.
 */
export const forkTheme = (from: BuiltinThemeId, changes: ThemeChanges): ThemeDocument => {
  const base = successorOf(from)
  const source = BUILTIN_THEMES[base]
  return {
    ...source,
    id: changes.id,
    name: changes.name,
    base,
    seeds: merged(source.seeds, changes.seeds),
    type: merged(source.type, changes.type),
    variants: merged(source.variants, changes.variants),
    shape: merged(source.shape, changes.shape),
    levers: changes.levers ?? source.levers,
    ...(changes.collections === undefined ? {} : { collections: changes.collections }),
    ...(changes.overrides === undefined ? {} : { overrides: changes.overrides }),
  }
}

/**
 * Reset a forked theme to the built-in it came from, keeping its identity. An
 * old fork whose base has been superseded resets to the successor, and keeps
 * the base it recorded, because that is what was saved.
 */
export const resetToBase = (theme: ThemeDocument): ThemeDocument =>
  theme.base === undefined
    ? theme
    : { ...BUILTIN_THEMES[theme.base], id: theme.id, name: theme.name, base: theme.base }
