import { toString } from 'mdast-util-to-string'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'

import { stripPresenterNotes } from '../directives/strip-presenter-notes.ts'
import { createSlugger, headingId } from './slug.ts'

export interface OutlineEntry {
  /** The heading's identifier in the rendered HTML, so a link can point at it. */
  readonly id: string
  readonly depth: number
  readonly text: string
  readonly children: readonly OutlineEntry[]
}

interface MutableEntry extends OutlineEntry {
  readonly children: OutlineEntry[]
}

/**
 * The heading tree, for tables of contents and for the outline the editor shows.
 * Identifiers match the rendered HTML because both are produced by the same
 * slugger walking the headings in document order, and both carry the
 * `HEADING_ID_PREFIX` a rendered heading ends up with.
 *
 * Matching depends on being given the *same tree* the renderer is given: a
 * slugger deduplicates, so a heading removed from one tree and not the other
 * shifts every `-1` suffix after it. `renderDocument` (./html.ts) exists so a
 * caller does not have to remember that. Presenter notes are dropped here for
 * the same reason the renderer drops them: a heading inside a note is not a
 * section the reader can reach.
 */
export function extractOutline(ast: Root): readonly OutlineEntry[] {
  const slug = createSlugger()
  const roots: OutlineEntry[] = []
  let open: MutableEntry[] = []

  visit(stripPresenterNotes(ast), 'heading', (node) => {
    const text = toString(node)
    const entry: MutableEntry = {
      id: headingId(slug(text)),
      depth: node.depth,
      text,
      children: [],
    }
    open = open.filter((candidate) => candidate.depth < entry.depth)
    const parent = open.at(-1)
    if (parent === undefined) roots.push(entry)
    else parent.children.push(entry)
    open.push(entry)
  })

  return roots
}
