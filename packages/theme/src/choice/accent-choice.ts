import { ACCENT_ROLES } from '../colour/accent.ts'
import { PALETTE_TOKEN_ROLES, type PaletteRole } from '../colour/palette.ts'
import type { ThemeDocument } from '../schema/theme-document.ts'
import type { TokenOverrides } from '../tokens.ts'
import type { ColourChoice } from './colour-choice.ts'
import { withAccentChoice } from './tone-choice.ts'

type Overrides = NonNullable<ThemeDocument['overrides']>

const ACCENT_ROLE_SET = new Set<PaletteRole>(ACCENT_ROLES)

/**
 * The tokens the generator derives from the accent seed, read from its own
 * role table rather than kept by hand, so a role added to the accent is
 * covered here the day it exists.
 */
export const ACCENT_TOKENS: ReadonlySet<string> = new Set(
  Object.entries(PALETTE_TOKEN_ROLES)
    .filter(([, role]) => ACCENT_ROLE_SET.has(role))
    .map(([token]) => token),
)

const withoutAccentTokens = (map: TokenOverrides | undefined): TokenOverrides | undefined => {
  if (map === undefined) return undefined
  const kept = Object.fromEntries(
    Object.entries(map).filter(([token]) => !ACCENT_TOKENS.has(token)),
  )
  return Object.keys(kept).length === 0 ? undefined : kept
}

const withoutAccentOverrides = (overrides: Overrides): Overrides | undefined => {
  const kept = Object.fromEntries(
    (['shared', 'light', 'dark'] as const)
      .map((scope) => [scope, withoutAccentTokens(overrides[scope])] as const)
      .filter(([, map]) => map !== undefined),
  )
  return Object.keys(kept).length === 0 ? undefined : kept
}

/**
 * A theme with a new accent. A built-in may pin tokens it derived from its
 * own accent — Calm's dark accent-subtle, Grid's tinted panels — and those
 * pins would keep the old hue under the new one, so every override of an
 * accent-derived token goes with the old accent. Every other pin stays, and a
 * neutral tone follows the accent as `withAccentChoice` describes.
 */
export const withAccent = (theme: ThemeDocument, accent: ColourChoice): ThemeDocument => {
  const { overrides, ...rest } = theme
  const kept = overrides === undefined ? undefined : withoutAccentOverrides(overrides)
  return {
    ...rest,
    seeds: withAccentChoice(theme.seeds, accent),
    ...(kept === undefined ? {} : { overrides: kept }),
  }
}
