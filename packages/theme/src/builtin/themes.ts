import type { ThemeDocument, ThemeVariants } from '../schema/theme-document.ts'
import {
  BUILTIN_THEME_IDS,
  SUPERSEDED_THEMES,
  type BuiltinThemeId,
  type OfferedThemeId,
} from '../schema/theme-ids.ts'
import { atelier } from './atelier.ts'
import { calm } from './calm.ts'
import { editorial } from './editorial.ts'
import { grid } from './grid.ts'
import { instrument } from './instrument.ts'

/** The built-ins a chooser offers, each its own document. */
export const OFFERED_THEMES: Readonly<Record<OfferedThemeId, ThemeDocument>> = {
  instrument,
  calm,
  editorial,
  grid,
  atelier,
}

const isOffered = (id: BuiltinThemeId): id is OfferedThemeId => Object.hasOwn(OFFERED_THEMES, id)

/**
 * The built-in a saved id stands for today: itself while it is offered, its
 * successor once it has been superseded. A fork records its `base`, and an
 * organisation's settings keep the whole document they saved, so a retired
 * id must keep resolving rather than fail (AGENTS.md rule 17); this is where
 * it does.
 */
export const successorOf = (id: BuiltinThemeId): OfferedThemeId =>
  isOffered(id) ? id : SUPERSEDED_THEMES[id]

/** The retired ids that now resolve to an offered theme: `['press']` for Editorial. */
export const supersededBy = (id: OfferedThemeId): readonly BuiltinThemeId[] =>
  BUILTIN_THEME_IDS.filter((known) => known !== id && successorOf(known) === id)

/**
 * Every id a theme document may name, resolved. A superseded id is the
 * successor's document, so "reset to Press" on an old fork resets to
 * Editorial, and `data-theme-id="press"` paints Editorial.
 */
export const BUILTIN_THEMES: Readonly<Record<BuiltinThemeId, ThemeDocument>> = {
  ...OFFERED_THEMES,
  press: OFFERED_THEMES[successorOf('press')],
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
