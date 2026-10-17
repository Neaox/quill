import { tokenStylesheet } from '@quill/highlight'
import type { ThemeDocument } from '@quill/theme'
import { readPublicSiteStyles } from '@quill/design-css'

import type { Hasher } from '@quill/application'

import type { ThemeStylesheets } from '../theme/theme-stylesheet.ts'

/**
 * The one stylesheet a public page loads (ADR-023, ADR-028, ADR-030).
 *
 * It is four things concatenated, in the order they have to cascade:
 *
 * 1. the organisation's **theme stylesheet** — the very sheet the application
 *    links from `/api/settings/organisation/theme.css` (`theme/`): the
 *    `--palette-*`, `--token-*`, `--font-*`, `--radius-*` and `--layout-*`
 *    values `@quill/theme` resolves from the theme document, light at the
 *    root and dark under `prefers-color-scheme`, scoped to the identity the
 *    page names in `data-theme-id`, and the `@font-face` rules for the faces
 *    the theme sets its type in (ADR-028). Embedded rather than linked, so a
 *    public page is still one immutable request rather than one of those and
 *    one that revalidates on every view;
 * 2. the **syntax token colours**: `@quill/highlight`'s `tokenStylesheet`,
 *    the very rules `packages/ui` writes into the application's CSS, so code
 *    is coloured the same on both (ADR-030);
 * 3. the **semantic layer and the site's furniture** (`public-site.css`);
 * 4. the **layout grid and reading typography** (`layout.css`, `prose.css`),
 *    which is what makes a block the same width and the same type on the web
 *    as it is in the app.
 *
 * Two properties matter more than the contents.
 *
 * **It is addressed by a hash of its own content.** `/s/_assets/theme-<hash>.css` is served
 * `immutable` with a year's lifetime, so a reader downloads it once and a
 * theme change produces a different address rather than a cache to bust. The
 * segment `_assets` can never collide with a site: `slugify` emits only
 * letters, digits and hyphens, so no site slug contains an underscore.
 *
 * The hash is of the finished CSS, not of the theme document: the faces'
 * addresses and the design system's own CSS are in it too, and either can
 * change with an upgrade while the theme stays as it was. A hash of the
 * document alone would hand a reader holding a year-long immutable copy the
 * old sheet under the new release.
 *
 * **It is generated once per theme, not once per request.** The colour
 * generator runs a gamut mapping and a contrast nudge per token; doing that on
 * a page view would be the most expensive thing on the page. So a small cache
 * holds the finished CSS by the hash of its theme document, and again by its
 * own hash, which is the address it is served at — the same object, found by
 * the page that links to it and by the reader who follows the link.
 */

/** The path prefix a public asset is served under. Never a valid site slug. */
export const PUBLIC_ASSET_PREFIX = '/s/_assets'

/** A year, in seconds: the lifetime of something addressed by its own content. */
export const ASSET_MAX_AGE_SECONDS = 31_536_000

export interface PublicStylesheet {
  /** A hash of the stylesheet itself, and the whole of its identity. */
  readonly hash: string
  /** The `data-theme-id` the page must carry for the theme in it to apply. */
  readonly identity: string
  readonly href: string
  readonly css: string
}

export interface PublicStylesheets {
  /** The finished stylesheet for this theme, generated on first sight and kept. */
  forTheme(theme: ThemeDocument): PublicStylesheet
  /** The stylesheet served at this hash, or null when nothing has generated it. */
  byHash(hash: string): PublicStylesheet | null
}

export interface PublicStylesheetOptions {
  readonly hasher: Hasher
  /** The organisation's theme as the application receives it, which is the first part of this one. */
  readonly themeStylesheets: ThemeStylesheets
  /**
   * The design system's plain CSS. Read once, at boot, because reading three
   * files off disk is not something a page view should ever do — and injected
   * rather than read here so a test can state exactly what it is asserting on.
   */
  readonly designSystemCss: string
}

export function publicAssetHref(hash: string): string {
  return `${PUBLIC_ASSET_PREFIX}/theme-${hash}.css`
}

/**
 * The design system's plain CSS, read off disk once per process.
 *
 * Memoised on the promise rather than on the value, so two composition roots
 * starting at once — the server and a test harness beside it — share the one
 * read instead of racing to issue two.
 */
let designSystemCss: Promise<string> | null = null

export function loadDesignSystemCss(): Promise<string> {
  designSystemCss ??= readPublicSiteStyles()
  return designSystemCss
}

export function createPublicStylesheets(options: PublicStylesheetOptions): PublicStylesheets {
  const byDocument = new Map<string, PublicStylesheet>()
  const byHash = new Map<string, PublicStylesheet>()
  const syntax = tokenStylesheet()

  return {
    forTheme(theme: ThemeDocument): PublicStylesheet {
      const documentHash = options.hasher.contentHash(JSON.stringify(theme))
      const known = byDocument.get(documentHash)
      if (known !== undefined) return known

      const themeSheet = options.themeStylesheets.forTheme(theme)
      const css = [themeSheet.css, syntax, options.designSystemCss].join('\n')
      const hash = options.hasher.contentHash(css).slice(0, 32)
      const sheet: PublicStylesheet = {
        hash,
        identity: themeSheet.identity,
        href: publicAssetHref(hash),
        css,
      }
      byDocument.set(documentHash, sheet)
      byHash.set(hash, sheet)
      return sheet
    },

    byHash(hash: string): PublicStylesheet | null {
      return byHash.get(hash) ?? null
    },
  }
}
