import { enhanceAnimatedImages } from '@quill/design-css/animated-images'
import { enhanceImages } from '@quill/design-css/image-viewer'
import { enhanceDiagrams } from '@quill/design-css/lightbox'
import { createBrowserHighlighting } from '@quill/highlight/browser'
import { applyHighlighting } from '@quill/highlight/client'

import { createBrowserDiagrams } from '../../lib/diagrams/browser-environment.ts'
import { drawDiagrams } from '../../lib/diagrams/draw-diagrams.ts'

/**
 * The enhancements a document body can take a moment after it is drawn, in a
 * chunk of their own (quill-plan.md section 31): none of them moves the text
 * a reader is looking at, so none has to be in the graph that arrives before
 * the first paint.
 *
 * - The CSS Custom Highlight API ranges over its code (ADR-030) colour text
 *   that is already laid out, and their grammars arrive on demand anyway.
 * - The diagrams are drawn into their slots by a renderer that is itself
 *   loaded on demand, and the lightbox each opens in is a press away.
 * - The animated emoji play briefly and then rest (ADR-047): starting a beat
 *   later is the same animation.
 * - Where a surface asks for it (`expandImages`, the presenter's live slide,
 *   ADR-050), each picture opens in the same lightbox, which is a press away.
 *
 * Code blocks' cards, tables' reading tools and details stay with the body
 * (`document-body.tsx`), because each changes the layout and would shift the
 * page if it arrived late.
 *
 * Run after those, which is also what the ranges need: a code block moved into
 * its card after its ranges were painted would leave them over nothing.
 * Returns what undoes each, in the order they were applied.
 */
export function enhanceAfterDrawing(
  article: HTMLElement,
  { expandImages }: { readonly expandImages: boolean },
): readonly (() => void)[] {
  const { environment, rootOf } = createBrowserHighlighting(window)
  return [
    ...applyHighlighting(rootOf(article), environment),
    drawDiagrams(article, createBrowserDiagrams(window, article)),
    enhanceDiagrams(article),
    enhanceAnimatedImages(article),
    ...(expandImages ? [enhanceImages(article)] : []),
  ]
}
