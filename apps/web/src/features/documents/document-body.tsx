import { useEffect, useEffectEvent, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { enhanceAnimatedImages } from '@quill/design-css/animated-images'
import { enhanceCodeBlocks } from '@quill/design-css/code-blocks'
import { enhanceDetails } from '@quill/design-css/details'
import { enhanceImages } from '@quill/design-css/image-viewer'
import { enhanceDiagrams } from '@quill/design-css/lightbox'
import { enhanceTables } from '@quill/design-css/tables'
import { createBrowserHighlighting } from '@quill/highlight/browser'
import { applyHighlighting } from '@quill/highlight/client'
import { languageLabel } from '@quill/markdown/code-languages'
import { cx, Prose } from '@quill/ui'

import { createBrowserDiagrams } from '../../lib/diagrams/browser-environment.ts'
import { drawDiagrams } from '../../lib/diagrams/draw-diagrams.ts'

export interface DocumentBodyProps {
  /** The cached body from `GET /documents/:id/rendered` (ADR-031). */
  readonly html: string
  /** Names the article region for assistive technology. */
  readonly label: string
  /**
   * Where the document sits, shown as its eyebrow when the body opens with its
   * own title and the author wrote none: normally the collection's name.
   */
  readonly eyebrow?: string | undefined
  readonly className?: string | undefined
  /**
   * Pictures open in the full-screen viewer, to zoom and pan: for a surface whose picture is read
   * at a distance or shared on a screen, such as the presenter's.
   */
  readonly expandImages?: boolean | undefined
  /**
   * Called each time the body has been drawn into the page: for a surface that has to give what it
   * mounted a state of its own (the presentation's open sections), which the HTML cannot carry.
   */
  readonly onMounted?: (() => void) | undefined
  /**
   * Draws what belongs in each child-documents block (`::children`) of the
   * body, given how deep it asks to go. The body only holds a slot for it
   * (ADR-032); omitted, the slot keeps its readable fallback, which is what a
   * surface with no workspace tree to draw from (a shared link, a slide) should
   * show.
   */
  readonly renderChildDocuments?: ((depth: number) => ReactNode) | undefined
}

/**
 * The rendered body of a document, on the reading grid.
 *
 * The body is a *string of HTML* produced by the server and cached by content
 * hash (ADR-031), so it is mounted into the DOM rather than rendered by
 * React. It is mounted onto the `Prose` article itself, not into a wrapper
 * inside it, because ADR-027's breakout widths are grid lines: a
 * `<div class="layout-wide">` has to be a *direct child* of the grid to span
 * them, and one wrapper between the two would quietly collapse every wide
 * table and full-width figure back to the reading measure.
 *
 * Nothing in the body is interactive, and none of it comes from a reader:
 * the Markdown pipeline sanitises on the server against an allowlist and
 * escapes raw HTML to text (ADR-011's input, output, and content rules), and
 * what arrives here is the cached artefact of a publish (ADR-031) with no
 * grammar attached (ADR-030).
 */
export function DocumentBody({
  html,
  label,
  eyebrow,
  className,
  expandImages = false,
  onMounted,
  renderChildDocuments,
}: DocumentBodyProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const hydrating = renderChildDocuments !== undefined
  const mounted = useEffectEvent(() => {
    onMounted?.()
  })

  // Parsed while rendering, because everything it yields is a function of the
  // HTML: the blocks to mount, and the slots the child-documents lists go in.
  // Knowing the slots *before* anything is mounted is what lets them be portals
  // drawn by this render, rather than elements discovered afterwards and handed
  // back to React through state.
  const body = useMemo(() => parseBody(html, hydrating), [html, hydrating])

  /* Synchronises the DOM with eight things React does not render: the
     server's rendered HTML, every code block's copy button and every code
     group's tabs (ADR-041), the CSS Custom Highlight API ranges painted over
     its code blocks (ADR-030), the diagrams drawn into its diagram slots,
     the lightbox every diagram opens in, every table's reading tools
     (ADR-040), the details a link or find points into (ADR-048), and the
     animated emoji that play briefly and then rest (ADR-047), and, where a surface asks for it,
     the pictures that open in the viewer. Keyed on the
     parsed body, which is what a new revision changes — a restore that
     reproduces an earlier body is the same body, and correctly repaints nothing. The eyebrow is part of what is
     mounted, so moving the document to another collection remounts it too. */
  useEffect(() => {
    const article = host.current?.querySelector('article')
    if (article == null) return undefined

    article.replaceChildren(...body.blocks)
    addEyebrow(article, eyebrow)

    const { environment, rootOf } = createBrowserHighlighting(window)
    // Cards before ranges: a bare block is moved into its card, and ranges
    // painted before the move would be painted over nothing.
    const disposers = [
      enhanceCodeBlocks(article, { languageLabel }),
      ...applyHighlighting(rootOf(article), environment),
      drawDiagrams(article, createBrowserDiagrams(window, article)),
      enhanceDiagrams(article),
      enhanceTables(article),
      enhanceDetails(article),
      enhanceAnimatedImages(article),
      ...(expandImages ? [enhanceImages(article)] : []),
    ]
    mounted()
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [body, eyebrow, expandImages])

  return (
    <>
      <div ref={host} className={cx(className)}>
        <Prose label={label}>{null}</Prose>
      </div>
      {renderChildDocuments === undefined
        ? null
        : body.childSlots.map(({ element, depth }, index) =>
            createPortal(renderChildDocuments(depth), element, String(index)),
          )}
    </>
  )
}

/**
 * The document's blocks, unwrapped from the `<article>` the renderer puts
 * around them.
 *
 * `renderHtml` emits one `<article>` so that a body is a complete document
 * wherever it is served — the public site, an export, an email — and `Prose`
 * is *also* an `<article>`, and is the reading grid. Nesting the two would
 * put every block one level below the grid, where `grid-column: wide` means
 * nothing and the vertical rhythm of `.prose > * + *` never applies: every
 * breakout table would silently snap back to the reading measure. So the
 * wrapper is dropped and its children become the grid items.
 *
 * A `<template>` is the parser: its content is inert, so nothing in it loads
 * or runs while this is deciding what to keep.
 */
function parseBody(html: string, claimChildSlots: boolean): ParsedBody {
  const template = document.createElement('template')
  template.innerHTML = html
  const first = template.content.firstElementChild
  const wrapper =
    first !== null && first.tagName === 'ARTICLE' && template.content.children.length === 1
      ? first
      : template.content
  const childSlots = claimChildSlots
    ? [...wrapper.querySelectorAll(CHILD_SLOT)].map(claimChildSlot)
    : []
  return { blocks: [...wrapper.childNodes], childSlots }
}

const CHILD_SLOT = 'section[data-live-block="children"]'

/** A child-documents block's place in the body, and how deep it asks to go. */
interface ChildSlot {
  readonly element: Element
  readonly depth: number
}

interface ParsedBody {
  readonly blocks: readonly Node[]
  readonly childSlots: readonly ChildSlot[]
}

/**
 * Takes a slot over from its readable fallback: the directive's source text is
 * what a reader without the application sees, and is cleared to make room for
 * the list that replaces it. The depth is the renderer's own `data-depth`,
 * already limited to the digits one to five (`render/sanitize-schema.ts`); a
 * value that is not one falls back to the direct children rather than to no limit.
 */
function claimChildSlot(element: Element): ChildSlot {
  const depth = Number(element.getAttribute('data-depth'))
  element.replaceChildren()
  element.setAttribute('aria-label', 'Child documents')
  return { element, depth: Number.isInteger(depth) && depth >= 1 ? depth : 1 }
}

/**
 * The automatic eyebrow: the part of the documentation a page belongs to, in
 * the accent's small capitals directly above its title, as the reference
 * documentation sites do ("Overview" over "The sync map").
 *
 * An author's eyebrow is a short paragraph written immediately before the
 * title, which the reading surface styles as one (`.prose > p:has(+ h1)` in
 * `@quill/design-css`). This adds exactly that paragraph, so the automatic one
 * is styled by the same rule and cannot look different from an authored one.
 * It is only added when the body *opens* with its title: a body whose title is
 * preceded by anything already has an eyebrow, or has chosen not to have one
 * there. A plain paragraph rather than a heading, so the outline, the table of
 * contents and a screen reader's heading list are untouched.
 */
function addEyebrow(article: Element, eyebrow: string | undefined): void {
  const title = article.firstElementChild
  if (eyebrow === undefined || eyebrow === '' || title?.tagName !== 'H1') return
  const paragraph = article.ownerDocument.createElement('p')
  paragraph.dataset['eyebrow'] = 'collection'
  paragraph.textContent = eyebrow
  title.before(paragraph)
}
