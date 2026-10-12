import type { Hasher } from '@quill/application'
import { readPublicReaderScript } from '@quill/design-css'

import { PUBLIC_ASSET_PREFIX } from './stylesheet.ts'

/**
 * The public site's second script: the reader, which paints every code block's
 * syntax highlighting (ADR-030) and gives every diagram its lightbox — the same
 * modules the signed-in reader imports, bundled ahead of time by
 * `@quill/design-css` because the public site has no bundler at run time
 * (ADR-023). Like the colour-scheme script it is a same-origin file addressed
 * by its own hash and served `immutable`, so the strict CSP admits it with no
 * inline script and no nonce (`scheme-script.ts` explains why a nonce cannot
 * work on a revalidated page). It is a module, so it runs once the page has
 * parsed and never blocks drawing it; without it, code is still readable
 * monospace and a diagram is still the figure it was.
 */
export interface ReaderScript {
  readonly hash: string
  readonly href: string
  readonly source: string
}

export function createReaderScript(
  hasher: Hasher,
  source: string = readPublicReaderScript(),
): ReaderScript {
  const hash = hasher.contentHash(source).slice(0, 32)
  return { hash, href: `${PUBLIC_ASSET_PREFIX}/reader-${hash}.js`, source }
}
