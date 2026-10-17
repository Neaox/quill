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

/** A heading before it has been placed in the tree. */
export type OutlineHeading = Omit<OutlineEntry, 'children'>

interface MutableEntry extends OutlineEntry {
  readonly children: OutlineEntry[]
}

/**
 * Nests headings by depth: a heading belongs to the nearest earlier heading that
 * is shallower than it. Skipping a level (an `h4` straight under an `h2`) is
 * allowed, because documents do it and a contents list must still list them.
 */
export function nestOutline(headings: Iterable<OutlineHeading>): readonly OutlineEntry[] {
  const roots: OutlineEntry[] = []
  let open: MutableEntry[] = []
  for (const heading of headings) {
    const entry: MutableEntry = { ...heading, children: [] }
    open = open.filter((candidate) => candidate.depth < entry.depth)
    const parent = open.at(-1)
    if (parent === undefined) roots.push(entry)
    else parent.children.push(entry)
    open.push(entry)
  }
  return roots
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
  const headings: OutlineHeading[] = []
  visit(stripPresenterNotes(ast), 'heading', (node) => {
    const text = toString(node)
    headings.push({ id: headingId(slug(text)), depth: node.depth, text })
  })
  return nestOutline(headings)
}

/** Every entry of an outline in document order, without building an array of them. */
export function* walkOutline(outline: readonly OutlineEntry[]): Generator<OutlineEntry> {
  for (const entry of outline) {
    yield entry
    yield* walkOutline(entry.children)
  }
}

/**
 * The headings between two depths, re-nested.
 *
 * Dropping a level splices its children into the level above rather than losing
 * them: a contents list of `h3`s alone still has to list every `h3`.
 */
export function outlineWithin(
  outline: readonly OutlineEntry[],
  min: number,
  max: number,
): readonly OutlineEntry[] {
  function* between(): Generator<OutlineEntry> {
    for (const entry of walkOutline(outline)) {
      if (entry.depth >= min && entry.depth <= max) yield entry
    }
  }
  return nestOutline(between())
}
