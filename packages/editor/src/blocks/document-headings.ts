import { nestOutline } from '@quill/markdown'
import type { OutlineEntry, OutlineHeading } from '@quill/markdown'
import type { NestedListItem } from '@quill/ui'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * The headings of the document being written, in order.
 *
 * The contents block shows these live, so it asks for them on every change to the
 * document. The walk is cached by document identity: a ProseMirror document is
 * immutable, so the same document is the same answer, and several blocks (or one
 * block re-rendered for a change that was not the document) cost one walk.
 *
 * Each heading's `id` is its position in the document rather than a slug: that is
 * what the block needs to take the caret there, and a slug would only be a guess
 * at the id the renderer will later give it.
 */

const CACHE = new WeakMap<PMNode, readonly OutlineHeading[]>()

export function documentHeadings(doc: PMNode): readonly OutlineHeading[] {
  const cached = CACHE.get(doc)
  if (cached !== undefined) return cached
  const headings: OutlineHeading[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    headings.push({ id: String(pos), depth: Number(node.attrs['level']), text: node.textContent })
  })
  CACHE.set(doc, headings)
  return headings
}

/** Whether two lists of headings would draw the same contents, so a redraw can be skipped. */
export function sameHeadings(
  a: readonly OutlineHeading[],
  b: readonly OutlineHeading[] | null,
): boolean {
  return (
    b !== null &&
    a.length === b.length &&
    a.every((heading, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        heading.id === other.id &&
        heading.depth === other.depth &&
        heading.text === other.text
      )
    })
  )
}

function listItem(entry: OutlineEntry): NestedListItem {
  return { id: entry.id, label: entry.text, children: entry.children.map(listItem) }
}

/**
 * The headings from `min` to `max`, nested the way the contents will read.
 * A level left out does not lose its children: a list of `h3`s alone still
 * lists every `h3`, which is what `nestOutline` does with a flat run.
 */
export function headingItems(
  headings: readonly OutlineHeading[],
  min: number,
  max: number,
): readonly NestedListItem[] {
  return nestOutline(headings.filter(({ depth }) => depth >= min && depth <= max)).map(listItem)
}
