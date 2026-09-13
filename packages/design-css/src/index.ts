import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The plain-CSS half of the design system.
 *
 * Three stylesheets that are ordinary CSS — no Tailwind directive, no build
 * step, no JavaScript — and the small amount of Node needed to read them off
 * disk. They live in a package of their own, with **no dependencies at all**,
 * because two very different consumers need them:
 *
 * - `@quill/ui` imports them into the application's stylesheet, where Tailwind
 *   compiles everything around them;
 * - `@quill/server` reads them as text and serves them to the public site,
 *   which has no bundler (ADR-023).
 *
 * Keeping them here is what lets the second consumer exist without the first:
 * a server that depended on `@quill/ui` to read three files would install
 * React, Radix, Sonner and nine font packages into every production tree for
 * the sake of forty lines of `readFile`. The direction is enforced by
 * `.dependency-cruiser.cjs`'s `server-does-not-import-ui` rule.
 *
 * What is *not* here is anything generated: colour comes from a theme document
 * through `@quill/theme` (ADR-028), and syntax token colours from
 * `@quill/highlight` (ADR-030). These files only ever name tokens.
 */

/**
 * The stylesheets a page needs, in the order they must cascade: the semantic
 * layer and the site's furniture first, then the layout grid, then reading
 * typography. A generated theme goes in front of all three, because everything
 * here is written in terms of its tokens.
 */
export const PUBLIC_SITE_STYLESHEETS = ['public-site.css', 'layout.css', 'prose.css'] as const

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Where one of this package's stylesheets lives on disk. */
export function styleSheetPath(name: string): string {
  return path.join(HERE, name)
}

/** The three stylesheets, concatenated in cascade order. */
export async function readPublicSiteStyles(): Promise<string> {
  const files = await Promise.all(
    PUBLIC_SITE_STYLESHEETS.map(async (name) => readFile(styleSheetPath(name), 'utf8')),
  )
  return files.join('\n')
}
