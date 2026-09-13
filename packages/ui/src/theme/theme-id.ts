/**
 * The tenant's identity, as the document sees it (ADR-028, layer 1).
 *
 * A theme is chosen by the workspace that published a document, not by the
 * reader, so this is deliberately not a preference: there is no storage here
 * and no default to remember. It is the attribute the generated palettes are
 * scoped to, the names and signature variants that go with each identity, and
 * the one function that writes the attribute.
 *
 * The reader's own choices — light, dark, or follow the system — are layer 3
 * and live in `theme.ts`. The two are independent: every identity ships both
 * schemes.
 *
 * This module is exported as `@quill/ui/theme` rather than from the package's
 * main entry, because the only thing that previews an identity is the design
 * showcase (and, later, the theme editor): keeping it out of the barrel is
 * what keeps every built-in theme document, and the `@quill/theme` machinery
 * behind them, out of the bundle a reader downloads (review 2026-09-13, H1).
 * The one piece the design system itself needs at runtime — the default
 * identity's signature variants — comes straight from `@quill/theme/builtin`
 * in `theme-variants.tsx`.
 */
import {
  BUILTIN_THEMES,
  BUILTIN_THEME_IDS,
  type BuiltinThemeId,
  type ThemeVariants,
} from '@quill/theme'

/** The attribute `tokens.css` scopes each generated palette to. */
export const THEME_ID_ATTRIBUTE = 'data-theme-id'

/** The built-in identities, in the order the theme editor offers them. */
export const THEME_IDS: readonly BuiltinThemeId[] = BUILTIN_THEME_IDS

/**
 * Instrument. Its palette also applies when the attribute is absent, which is
 * what makes it the default for a new instance (ADR-028). `theme-id.test.ts`
 * holds this to `DEFAULT_THEME` in `@quill/theme`.
 */
export const DEFAULT_THEME_ID: BuiltinThemeId = 'instrument'

export function isThemeId(value: unknown): value is BuiltinThemeId {
  return THEME_IDS.some((id) => id === value)
}

/** The identity's human name, for a control that offers the choice. */
export function themeIdName(id: BuiltinThemeId): string {
  return BUILTIN_THEMES[id].name
}

/** The identity's signature variants, for a shell that has to pick one. */
export function themeIdVariants(id: BuiltinThemeId): ThemeVariants {
  return BUILTIN_THEMES[id].variants
}

/**
 * Writes the identity onto an element, usually `document.documentElement`.
 *
 * The default identity removes the attribute rather than writing its own name,
 * so a page that has never been themed and a page themed to the default are
 * the same page, and the stylesheet has one fewer thing to match.
 */
export function applyThemeId(element: Element, id: BuiltinThemeId): void {
  if (id === DEFAULT_THEME_ID) {
    element.removeAttribute(THEME_ID_ATTRIBUTE)
    return
  }
  element.setAttribute(THEME_ID_ATTRIBUTE, id)
}
