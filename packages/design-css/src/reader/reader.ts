import { createBrowserHighlighting, type HighlightWindow } from '@quill/highlight/browser'
import { applyHighlighting } from '@quill/highlight/client'
import { languageLabel } from '@quill/markdown/code-languages'

import { enhanceAnimatedImages } from '../animated-images/animated-images.ts'
import { enhanceCodeBlocks } from '../code-blocks/code-blocks.ts'
import { enhanceContents } from '../contents-spy/contents-spy.ts'
import { enhanceDetails } from '../details/details.ts'
import { enhanceDiagrams } from '../lightbox/lightbox.ts'
import { trackStickyChrome } from '../sticky-chrome/sticky-chrome.ts'
import { enhanceTables } from '../tables/tables.ts'

/**
 * The public reader: everything a server-rendered page does once it has
 * parsed, which is the same two passes the signed-in reader runs over a
 * document body (`apps/web`, `document-body.tsx`).
 *
 * - **Code is painted** (ADR-030). Each fenced block arrives as one text node
 *   carrying `data-lang` and packed `data-tokens`; `applyHighlighting` paints
 *   those ranges through the CSS Custom Highlight API, or swaps in `tok-*`
 *   spans where the browser has no `CSS.highlights`. Without this script the
 *   block is still the plain, readable monospace it was.
 * - **Code can be copied, and code groups become tabs**
 *   (`../code-blocks/code-blocks.ts`, ADR-041).
 * - **Diagrams open in the lightbox** (`../lightbox/lightbox.ts`).
 * - **Tables get their reading tools** (`../tables/tables.ts`, ADR-040): a
 *   header and footer that stay in view, click-to-sort, scroll shadows and
 *   the full-screen viewer.
 * - **Details open where a link, a text fragment or find points into them**,
 *   accordions stay exclusive, and print shows every one
 *   (`../details/details.ts`, ADR-048).
 * - **Animated emoji play briefly, then rest on their still**
 *   (`../animated-images/animated-images.ts`, ADR-047), as the person's
 *   setting says; reduced motion is the picture's own and needs none of this.
 * - **"On this page" follows the reader** (`../contents-spy/contents-spy.ts`):
 *   the section being read is marked in the contents, as in the app, and in
 *   every table of contents block the body holds (ADR-056).
 * - **The site header is measured** (`../sticky-chrome/sticky-chrome.ts`), so
 *   a hanging table header and an anchor target clear it however it wraps.
 *
 * The public site has no bundler at run time (ADR-023), so this module and
 * everything it imports is bundled ahead of time into `reader.gen.js`
 * (`bundle.ts`), which the server serves as a same-origin, hash-addressed
 * module script. The whole document is the root: a public page holds one
 * document, and nothing outside its article carries `data-tokens` or
 * `.diagram`.
 */
export interface ReaderWindow extends HighlightWindow {
  readonly document: Document
}

/** Enhances the page `view` shows. Returns what takes every enhancement away again. */
export function enhanceReader(view: ReaderWindow): () => void {
  const { environment, rootOf } = createBrowserHighlighting(view)
  // Cards first: a bare block is moved into one, and ranges painted before
  // the move would be painted over nothing.
  const disposers = [
    enhanceCodeBlocks(view.document, { languageLabel }),
    ...applyHighlighting(rootOf(view.document), environment),
    trackStickyChrome(view.document.querySelector('.site-header'), view.document.documentElement),
    // After the header is measured, so the contents' band starts below it.
    enhanceContents(view.document),
    enhanceDiagrams(view.document),
    enhanceTables(view.document),
    enhanceDetails(view.document),
    enhanceAnimatedImages(view.document),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
