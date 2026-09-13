import type { OutlineEntry } from '../../../lib/api/index.ts'
import { sections } from '../table-of-contents.tsx'

/**
 * A document's sections become a presentation's steps (quill-plan.md section
 * 14).
 *
 * The split is over the *rendered body* the reading view already has — the
 * cached HTML of ADR-031, which the render cache produced once and every
 * reader shares — so presenting costs no extra render and shows exactly what
 * the page shows. The outline that comes with it (`sections`, the same
 * function the table of contents uses) says where the boundaries are, so the
 * steps and the contents can never disagree about what a section is.
 */

export interface PresentStep {
  /** The heading's id in the body, which is also the anchor the reading view uses. */
  readonly id: string
  readonly title: string
  /** The body of this step, in the `<article>` wrapper `DocumentBody` expects. */
  readonly html: string
}

/** Everything in the body before the first section: the document's opening. */
const LEAD_ID = 'present-opening'

/**
 * The element carrying a heading id, whether the renderer emitted the id on a
 * top-level block or on a heading inside one.
 */
function startsSection(node: Element, id: string): boolean {
  return node.id === id || node.querySelector(`[id=${JSON.stringify(id)}]`) !== null
}

/**
 * The document's own blocks, unwrapped from the `<article>` the renderer puts
 * around a body, and parsed inertly: a `<template>`'s content loads and runs
 * nothing while this is deciding where the sections start.
 */
function blocksOf(html: string, ownerDocument: Document): readonly Element[] {
  const template = ownerDocument.createElement('template')
  template.innerHTML = html
  const first = template.content.firstElementChild
  const root =
    first !== null && first.tagName === 'ARTICLE' && template.content.children.length === 1
      ? first
      : template.content
  return [...root.children]
}

function article(blocks: readonly Element[]): string {
  return `<article>${blocks.map((block) => block.outerHTML).join('')}</article>`
}

/**
 * The steps of a presentation, in document order.
 *
 * The first step is whatever stands above the first section — the title, the
 * standfirst, the summary table — because that is the slide a room is looking
 * at while the presenter says what this is. It is dropped when there is
 * nothing above the first section, so a document that opens straight into a
 * heading does not start on an empty screen. A document with no sections at
 * all is one step: the whole of it.
 */
export function splitSteps(
  html: string,
  outline: readonly OutlineEntry[],
  documentTitle: string,
  ownerDocument: Document,
): readonly PresentStep[] {
  const headings = sections(outline)
  const blocks = blocksOf(html, ownerDocument)
  if (blocks.length === 0) return []

  const opening: Element[] = []
  const steps: { id: string; title: string; blocks: Element[] }[] = []
  let remaining = headings

  for (const block of blocks) {
    const next = remaining[0]
    if (next !== undefined && startsSection(block, next.id)) {
      steps.push({ id: next.id, title: next.text, blocks: [block] })
      remaining = remaining.slice(1)
      continue
    }
    const current = steps.at(-1)
    if (current === undefined) opening.push(block)
    else current.blocks.push(block)
  }

  const root = outline.length === 1 && outline[0]?.depth === 1 ? outline[0] : undefined
  const lead =
    opening.length === 0
      ? []
      : [
          {
            id: root?.id ?? LEAD_ID,
            title: root?.text ?? documentTitle,
            html: article(opening),
          },
        ]

  return [...lead, ...steps.map((step) => ({ ...step, html: article(step.blocks) }))]
}
