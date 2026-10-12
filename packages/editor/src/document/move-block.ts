import { Fragment } from '@tiptap/pm/model'
import type { ResolvedPos } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'

/**
 * Moving a block up or down with the keyboard (Alt+Up, Alt+Down), as a list or an outline lets you.
 *
 * What moves is the paragraph, heading or other line of text the caret is in, among the blocks
 * beside it; or, in a list, the item, with everything nested in it, among its fellows. It does not
 * leave the block that holds it: a paragraph at the end of a callout stays at the end of it, rather
 * than the callout jumping a block, which is not what pressing the key beside a paragraph means. A
 * table's own row and column moves have the same keys (`table-commands.ts`) and keep their cells, so
 * the caret in a table is left to them.
 */

const LIST_ITEMS: ReadonlySet<string> = new Set(['listItem', 'taskItem'])
const CELLS: ReadonlySet<string> = new Set(['tableCell', 'tableHeader'])

/** The depth of what moves: the nearest list item above the caret, or else the line of text itself. */
function movingDepth($pos: ResolvedPos): number | undefined {
  const names = Array.from(
    { length: $pos.depth },
    (_, above) => $pos.node($pos.depth - above).type.name,
  )
  if (names.length === 0 || names.some((name) => CELLS.has(name))) return undefined
  const item = names.findIndex((name) => LIST_ITEMS.has(name))
  return item < 0 ? $pos.depth : $pos.depth - item
}

export function moveBlock(by: -1 | 1): Command {
  return (state, dispatch) => {
    const { selection } = state
    if (!(selection instanceof TextSelection)) return false
    const { $from, $to } = selection
    const depth = movingDepth($from)
    // A selection that runs on into another block is not asking to move one.
    if (depth === undefined || $from.sharedDepth($to.pos) < depth) return false

    const parent = $from.node(depth - 1)
    const index = $from.index(depth - 1)
    const other = parent.maybeChild(index + by)
    if (other === null) return false

    const moving = $from.node(depth)
    const swapped = Fragment.from(by === 1 ? [other, moving] : [moving, other])
    const first = Math.min(index, index + by)
    // A parent whose schema fixes the order of its children would refuse; none of the blocks do yet.
    /* v8 ignore next */
    if (!parent.canReplace(first, first + 2, swapped)) return false

    if (dispatch !== undefined) {
      const start = by === 1 ? $from.before(depth) : $from.before(depth) - other.nodeSize
      const tr = state.tr.replaceWith(start, start + moving.nodeSize + other.nodeSize, swapped)
      // The words keep the caret: they have moved by the size of the block they swapped with.
      const shift = by * other.nodeSize
      tr.setSelection(TextSelection.create(tr.doc, $from.pos + shift, $to.pos + shift))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}
