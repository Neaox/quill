import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { enhanceCodeBlocks } from '@quill/design-css/code-blocks'
import { enhanceContents } from '@quill/design-css/contents-spy'
import { enhanceDetails } from '@quill/design-css/details'
import { enhanceTables } from '@quill/design-css/tables'
import { languageLabel } from '@quill/markdown/code-languages'
import { cx, onDemand, Prose, SHELL_HEADER_HEIGHT_PX } from '@quill/ui'

import { readableBodyLinks, routeBodyLinks } from './body-links.ts'
import type { DocumentLinksLoader } from './body-links.ts'
import { fillChildPageSlots } from './child-pages-slots.ts'
import type { ChildPagesSlotsOptions } from './child-pages-slots.ts'

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
  /**
   * One more enhancement, run last over the mounted body, returning its own
   * undo: the comparison view folds unchanged stretches this way
   * (`compare/comparison-surface.ts`). Keep it stable — a new function is a
   * remount.
   */
  readonly enhance?: ((article: HTMLElement) => () => void) | undefined
  /**
   * Answers the body's child pages slots for this reader (ADR-054). Omitted
   * — a shared link, a specimen — the slots keep their fallback line. Keep it
   * stable: a new function asks again.
   */
  readonly loadChildPages?: ChildPagesSlotsOptions['load'] | undefined
  /** Offered in an empty child pages list to someone who can write here. Keep it stable. */
  readonly onCreateChildPage?: (() => void) | undefined
  /**
   * What goes straight under the body's own title: the document's byline
   * (`docs/design/properties.md`). Rendered by React into a slot the mount
   * puts after the title, so it can change — the envelope arriving, a
   * relative date moving on — without the body being mounted again.
   */
  readonly afterTitle?: ReactNode
  /**
   * Follows a click on a link into the application — another document, a
   * workspace, a share page — without reloading it: normally the router's
   * `navigate` (`useFollowLink`). Modifier and middle clicks, targets and
   * downloads stay the browser's (`body-links.ts`). Omitted, every link is
   * followed by the browser.
   */
  readonly onFollowLink?: ((href: string) => void) | undefined
  /**
   * Answers the body's stored links (`/d/<id>`) with their reading addresses
   * for this reader, in one request (ADR-035), so hovering over or copying a
   * link shows where it goes. Omitted — a shared link, whose server already
   * readdressed them — they stay as stored. Keep it stable: a new function
   * asks again.
   */
  readonly loadLinks?: DocumentLinksLoader | undefined
  readonly className?: string | undefined
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
  enhance,
  loadChildPages,
  onCreateChildPage,
  afterTitle,
  onFollowLink,
  loadLinks,
  className,
}: DocumentBodyProps) {
  const host = useRef<HTMLDivElement | null>(null)
  // One element for the life of the body, so a portal into it survives every
  // remount of the HTML around it.
  const [titleSlot] = useState(() => {
    const slot = document.createElement('div')
    slot.dataset['bylineSlot'] = ''
    return slot
  })
  const childPages = useRef({ loadChildPages, onCreateChildPage, loadLinks })
  const followLink = useRef(onFollowLink)
  /* Synchronises the box the mounted body's link listener reads with the
     latest prop, so a new function from the caller costs no remount. */
  useEffect(() => {
    followLink.current = onFollowLink
  }, [onFollowLink])
  /* Synchronises the box the mounted body's child pages slots read (ADR-054),
     outside React, with the latest props: read when a body is mounted and
     when a list arrives, so permissions arriving later cause no remount. */
  useEffect(() => {
    childPages.current = { loadChildPages, onCreateChildPage, loadLinks }
  }, [loadChildPages, onCreateChildPage, loadLinks])

  /* Synchronises the DOM with eight things React does not render: the
     server's rendered HTML, every code block's copy button and every code
     group's tabs (ADR-041), the CSS Custom Highlight API ranges painted over
     its code blocks (ADR-030), the diagrams drawn into its diagram slots,
     the lightbox every diagram opens in, every table's reading tools
     (ADR-040), the details a link or find points into (ADR-048), and the
     animated emoji that play briefly and then rest (ADR-047). Keyed on the
     HTML itself, which is what a new revision changes — a restore that reproduces an earlier body is the same
     body, and correctly repaints nothing. The eyebrow is part of what is
     mounted, so moving the document to another collection remounts it too. */
  useEffect(() => {
    const article = host.current?.querySelector('article')
    if (!(article instanceof HTMLElement)) return undefined

    article.replaceChildren(...blocksOf(html, article.ownerDocument))
    addEyebrow(article, eyebrow)
    article.querySelector(':scope > h1')?.after(titleSlot)

    const disposers = [
      enhanceCodeBlocks(article, { languageLabel }),
      enhanceTables(article),
      enhanceDetails(article),
      // Every table of contents in the body marks the section being read,
      // as the rail beside it does (ADR-054).
      enhanceContents(article.ownerDocument, {
        links: 'article nav.toc a[href^="#"]',
        topInset: () => SHELL_HEADER_HEIGHT_PX,
      }),
      // The pages under this one, for this reader (ADR-032, ADR-054).
      ...(childPages.current.loadChildPages === undefined
        ? []
        : [
            fillChildPageSlots(article, {
              load: childPages.current.loadChildPages,
              get createChildPage() {
                return childPages.current.onCreateChildPage
              },
            }),
          ]),
      // Links into the application are followed by the router (ADR-035).
      routeBodyLinks(article, () => followLink.current),
      // Each stored link under its readable address, for this reader.
      ...(childPages.current.loadLinks === undefined
        ? []
        : [readableBodyLinks(article, childPages.current.loadLinks)]),
      ...(enhance === undefined ? [] : [enhance(article)]),
    ]
    // What changes the layout is applied above, with the body, so nothing
    // shifts; the code's ranges, the diagrams and the animated emoji follow from
    // their own chunk (`deferred-enhancements.ts`), which is normally here
    // already — it is asked for when this module loads, below.
    let afterDrawing: readonly (() => void)[] = []
    let mounted = true
    const deferred = deferredEnhancements.current()
    if (deferred === undefined) {
      deferredEnhancements.load().then(
        (arrived) => {
          if (mounted) afterDrawing = arrived.enhanceAfterDrawing(article)
        },
        // Without the chunk the body still reads; it is asked for again on
        // the next mount.
        () => undefined,
      )
    } else {
      afterDrawing = deferred.enhanceAfterDrawing(article)
    }
    return () => {
      mounted = false
      for (const dispose of [...disposers, ...afterDrawing].toReversed()) dispose()
    }
  }, [html, eyebrow, enhance, titleSlot])

  return (
    <div ref={host} className={cx(className)}>
      <Prose label={label}>{null}</Prose>
      {afterTitle === undefined ? undefined : createPortal(afterTitle, titleSlot)}
    </div>
  )
}

/**
 * The body's enhancements that wait for it to be drawn
 * (`deferred-enhancements.ts`), fetched on demand.
 */
const deferredEnhancements = onDemand(() => import('./deferred-enhancements.ts'))

/*
 * Asked for as soon as this module is evaluated, which is when the reading
 * route's chunk arrives — in parallel with the route's data, and before the
 * body itself — so a body is normally enhanced in the frame it is drawn in.
 */
void deferredEnhancements.load().catch(() => undefined)

/** Waits for those enhancements, for a test that should render as a settled page does. */
export function preloadDocumentEnhancements(): Promise<unknown> {
  return deferredEnhancements.load()
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
function blocksOf(html: string, ownerDocument: Document): readonly Node[] {
  const template = ownerDocument.createElement('template')
  template.innerHTML = html
  const first = template.content.firstElementChild
  const wrapper =
    first !== null && first.tagName === 'ARTICLE' && template.content.children.length === 1
      ? first
      : template.content
  return [...wrapper.childNodes]
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
