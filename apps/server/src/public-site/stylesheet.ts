import { tokenCssContract } from '@quill/highlight'
import { generateTheme, toCss } from '@quill/theme'
import type { ThemeDocument } from '@quill/theme'
import { readPublicSiteStyles } from '@quill/design-css'

import type { Hasher } from '@quill/application'

/**
 * The one stylesheet a public page loads (ADR-023, ADR-028, ADR-030).
 *
 * It is four things concatenated, in the order they have to cascade:
 *
 * 1. the organisation's **generated theme** — the `--palette-*`, `--token-*`,
 *    `--font-*`, `--radius-*` and `--layout-*` values that `@quill/theme`
 *    resolves from its theme document, with light at the root and dark under
 *    `prefers-color-scheme` (ADR-028);
 * 2. the **syntax token colours**, which are the same two selector families
 *    `packages/ui` generates from `@quill/highlight`'s contract (ADR-030);
 * 3. the **semantic layer and the site's furniture** (`public-site.css`);
 * 4. the **layout grid and reading typography** (`layout.css`, `prose.css`),
 *    which is what makes a block the same width and the same type on the web
 *    as it is in the app.
 *
 * Two properties matter more than the contents.
 *
 * **It is addressed by its own hash.** `/s/_assets/theme-<hash>.css` is served
 * `immutable` with a year's lifetime, so a reader downloads it once and a
 * theme change produces a different address rather than a cache to bust. The
 * segment `_assets` can never collide with a site: `slugify` emits only
 * letters, digits and hyphens, so no site slug contains an underscore.
 *
 * **It is generated once per theme, not once per request.** The colour
 * generator runs a gamut mapping and a contrast nudge per token; doing that on
 * a page view would be the most expensive thing on the page. So a small cache
 * holds the finished CSS by the hash of its theme document, which is also the
 * address it is served at — the same object, found the same way, by the reader
 * and by the page that links to it.
 */

/** The path prefix a public asset is served under. Never a valid site slug. */
export const PUBLIC_ASSET_PREFIX = '/s/_assets'

/** A year, in seconds: the lifetime of something addressed by its own content. */
export const ASSET_MAX_AGE_SECONDS = 31_536_000

export interface PublicStylesheet {
  /** The hash of the theme that produced it, and the whole of its identity. */
  readonly hash: string
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

/** The syntax token colours, as `packages/ui` generates them (ADR-030). */
function syntaxCss(): string {
  const { variables, classSelectors, highlightSelectors } = tokenCssContract()
  // The two selector families are never comma-joined: a browser that does not
  // know `::highlight()` drops a whole selector list containing one, which
  // would take the markup rules down with it.
  return variables
    .flatMap((variable, index) =>
      [classSelectors[index], highlightSelectors[index]].map(
        (selector) => `${selector} { color: var(${variable}); }`,
      ),
    )
    .join('\n')
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
  const byHash = new Map<string, PublicStylesheet>()
  const syntax = syntaxCss()

  return {
    forTheme(theme: ThemeDocument): PublicStylesheet {
      const hash = options.hasher.contentHash(JSON.stringify(theme)).slice(0, 32)
      const known = byHash.get(hash)
      if (known !== undefined) return known

      const sheet: PublicStylesheet = {
        hash,
        href: publicAssetHref(hash),
        css: [toCss(generateTheme(theme)), syntax, options.designSystemCss].join('\n'),
      }
      byHash.set(hash, sheet)
      return sheet
    },

    byHash(hash: string): PublicStylesheet | null {
      return byHash.get(hash) ?? null
    },
  }
}
