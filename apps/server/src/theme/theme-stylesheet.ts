import { fontFaceCss, generateTheme, toCss } from '@quill/theme'
import type { ThemeDocument } from '@quill/theme'

import type { Hasher } from '@quill/application'

import type { FaceFiles } from './face-files.ts'

/**
 * The organisation's theme, delivered as a stylesheet (ADR-028, "Delivery").
 *
 * A theme document is not CSS; this is where it becomes some, on the server,
 * so that `@quill/theme`'s generator and doctor never enter a reader's bundle
 * (review 2026-09-13, H1). The sheet is exactly what the generator writes for
 * the built-in identities in `packages/ui` — light at the root, dark under
 * `prefers-color-scheme` unless the reader chose light, and the explicit
 * `data-theme='dark'` and `'light'` choices — plus the `@font-face` rules for
 * the faces the theme names, so a page with no bundle behind it still sets
 * the theme's type.
 *
 * **Scoped to the identity, one step more specific than the bundle.** The
 * application already carries every built-in identity's palette, each scoped
 * to `:root[data-theme-id='<id>']` (Instrument also to `:root` with no
 * attribute). This sheet is scoped to `html:root[data-theme-id='<identity>']`:
 * the extra type selector outranks every bundled block whatever order the two
 * stylesheets arrive in — and Vite decides that order, not the application —
 * so a customised theme always wins over the built-in it was forked from,
 * while a page whose attribute has not been written yet still has the
 * bundled identity under it rather than nothing.
 *
 * **The identity** is the built-in a theme was forked from, or the theme's own
 * id when it is a built-in or was never forked. That is what `data-theme-id`
 * on `<html>` says, so the `theme-press:`-style variants a component may carry
 * (`docs/architecture/styling.md`) still apply to a customised Press.
 *
 * **Generated once per theme.** The generator runs a gamut mapping and a
 * contrast nudge per token; doing that per request would be the most
 * expensive thing on any page. A small map holds the finished sheet by the
 * hash of its theme document.
 */

/** The address the application links. The query is a cache key, never read. */
export const THEME_STYLESHEET_PATH = '/api/settings/organisation/theme.css'

/** What `data-theme-id` may be: a theme document's id, or a built-in's. */
const IDENTITY = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/u

/** How many themes' sheets one process keeps. A theme changes a few times a year. */
const KEPT_THEMES = 16

export interface ThemeStylesheet {
  /** The value of `data-theme-id` on `<html>` that this sheet applies under. */
  readonly identity: string
  /** A hash of the CSS itself, and the whole of its identity. */
  readonly hash: string
  readonly css: string
  /** Where the application links it: the route, with the hash as a cache key. */
  readonly href: string
}

export interface ThemeStylesheets {
  forTheme(theme: ThemeDocument): ThemeStylesheet
}

export interface ThemeStylesheetOptions {
  readonly hasher: Hasher
  readonly faceFiles: FaceFiles
}

/** The `data-theme-id` a theme applies under. */
export function themeIdentity(theme: ThemeDocument): string {
  const identity = theme.base ?? theme.id
  // The schema already holds an id to this shape; the check is here because
  // the value is about to become part of a selector.
  if (!IDENTITY.test(identity)) throw new Error(`Not a theme identity: ${identity}`)
  return identity
}

/** The selector a delivered theme is scoped to. */
export function deliveryScope(identity: string): string {
  return `html:root[data-theme-id='${identity}']`
}

export function createThemeStylesheets(options: ThemeStylesheetOptions): ThemeStylesheets {
  const byDocument = new Map<string, ThemeStylesheet>()

  return {
    forTheme(theme) {
      const documentHash = options.hasher.contentHash(JSON.stringify(theme))
      const known = byDocument.get(documentHash)
      if (known !== undefined) return known

      const identity = themeIdentity(theme)
      const css = [
        toCss(generateTheme(theme), { selector: deliveryScope(identity) }),
        fontFaceCss(theme, { curatedHref: options.faceFiles.href }),
        '',
      ].join('\n')
      const hash = options.hasher.contentHash(css).slice(0, 32)
      const sheet: ThemeStylesheet = {
        identity,
        hash,
        css,
        href: `${THEME_STYLESHEET_PATH}?v=${hash}`,
      }

      if (byDocument.size >= KEPT_THEMES) {
        const oldest = byDocument.keys().next()
        /* v8 ignore next -- the map is full, so it has a first key. */
        if (oldest.done !== true) byDocument.delete(oldest.value)
      }
      byDocument.set(documentHash, sheet)
      return sheet
    },
  }
}
