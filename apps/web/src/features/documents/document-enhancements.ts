import { enhanceAnimatedImages } from '@quill/design-css/animated-images'
import { enhanceCodeBlocks } from '@quill/design-css/code-blocks'
import { enhanceDetails } from '@quill/design-css/details'
import { enhanceImages } from '@quill/design-css/image-viewer'
import { enhanceDiagrams } from '@quill/design-css/lightbox'
import { enhanceTables } from '@quill/design-css/tables'
import { createBrowserHighlighting } from '@quill/highlight/browser'
import { applyHighlighting } from '@quill/highlight/client'
import { languageLabel } from '@quill/markdown/code-languages'

import { createBrowserDiagrams } from '../../lib/diagrams/browser-environment.ts'
import { drawDiagrams } from '../../lib/diagrams/draw-diagrams.ts'

/**
 * Everything a document's rendered body gains once it is in the page: the
 * copy buttons and tabs on code, the highlighting painted over it, the
 * diagrams, the lightbox, the tables' reading tools, the details a link points
 * into, the animated emoji, and, where asked, the picture viewer.
 *
 * Its own module so that `DocumentBody` loads it with a dynamic `import()`:
 * the words of a document are readable the moment the HTML is mounted, and
 * these behaviours are an enhancement that arrives a moment later, so they
 * stay out of the reading route's first-render bundle
 * (`docs/operations/bundle-budget.md`).
 *
 * Returns the disposers that undo each enhancement.
 */
export function enhanceDocument(
  article: HTMLElement,
  options: { readonly expandImages: boolean },
): readonly (() => void)[] {
  const { environment, rootOf } = createBrowserHighlighting(window)
  // Cards before ranges: a bare block is moved into its card, and ranges
  // painted before the move would be painted over nothing.
  return [
    enhanceCodeBlocks(article, { languageLabel }),
    ...applyHighlighting(rootOf(article), environment),
    drawDiagrams(article, createBrowserDiagrams(window, article)),
    enhanceDiagrams(article),
    enhanceTables(article),
    enhanceDetails(article),
    enhanceAnimatedImages(article),
    ...(options.expandImages ? [enhanceImages(article)] : []),
  ]
}
