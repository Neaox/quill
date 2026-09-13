import { useEffect, useRef } from 'react'

import { applyHighlighting } from '@quill/highlight/client'
import { cx, Prose, proseTableStyles, scrollGroupStyles } from '@quill/ui'

import { createBrowserHighlighting } from '../../lib/highlight/browser-environment.ts'

export interface DocumentBodyProps {
  /** The cached body from `GET /documents/:id/rendered` (ADR-031). */
  readonly html: string
  /** Names the article region for assistive technology. */
  readonly label: string
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
export function DocumentBody({ html, label, className }: DocumentBodyProps) {
  const host = useRef<HTMLDivElement | null>(null)

  /* Synchronises the DOM with two things React does not render: the server's
     rendered HTML, and the CSS Custom Highlight API ranges painted over its
     code blocks (ADR-030). Keyed on the HTML itself, which is what a new
     revision changes — a restore that reproduces an earlier body is the same
     body, and correctly repaints nothing. */
  useEffect(() => {
    const article = host.current?.querySelector('article')
    if (article == null) return undefined

    article.replaceChildren(...blocksOf(html, article.ownerDocument))
    makeTablesScrollable(article)

    const { environment, rootOf } = createBrowserHighlighting(window)
    const disposers = applyHighlighting(rootOf(article), environment)
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [html])

  return (
    <div ref={host} className={cx(className)}>
      <Prose label={label}>{null}</Prose>
    </div>
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
 * ADR-027: "tables are always scrollable horizontally inside their width".
 *
 * The Markdown renderer emits a bare `<table>` as a grid item, so the scroll
 * region `ProseTable` gives a *composed* table has to be put around a rendered
 * one here. `ProseTable` itself cannot be: it takes the table as a React
 * child, and this body is mounted DOM rather than elements React owns. What it
 * is made of can still be the same one source of truth, so the classes, the
 * role, and the tab stop are read from the primitive's own style functions
 * rather than copied — a change to `ScrollGroup` reaches a rendered table
 * without anyone remembering this file.
 *
 * TODO(ADR-027): move the wrapper into `packages/markdown`'s table handler, so
 * the public site and HTML export get it without this pass at all.
 */
function makeTablesScrollable(article: Element): void {
  const className = cx(proseTableStyles(), scrollGroupStyles())
  for (const table of article.querySelectorAll('table')) {
    const region = article.ownerDocument.createElement('div')
    region.className = className
    region.tabIndex = 0
    region.setAttribute('role', 'group')
    region.setAttribute('aria-label', table.querySelector('caption')?.textContent ?? 'Table')
    table.replaceWith(region)
    region.append(table)
  }
}
