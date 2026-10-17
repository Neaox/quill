import type { Node as PMNode } from '@tiptap/pm/model'
import { Selection, TextSelection, type Command } from '@tiptap/pm/state'

import { isTableWrapper } from '../table/table-context.ts'
import { atEdge, inCode, type Direction } from './block-edges.ts'

/**
 * Stepping into a table from the paragraph beside it, from the keyboard.
 *
 * Down and Right at the end of the block above a table, Up and Left at the start of the block below
 * it, go to the table's nearest cell. Left to the browser they do not: Chromium finds the cell, but
 * Firefox puts its caret in the table's (empty) column group, where the editor has no position for
 * it. The caret disappears, the next press goes on through to the far side, and Right seems to do
 * nothing at all. The editor takes the key and says where the caret goes, so every browser does
 * the same.
 */

const isTable = (node: PMNode): boolean => node.type.name === 'table' || isTableWrapper(node)

export function enterTable(direction: Direction): Command {
  const forward = direction === 'down' || direction === 'right'
  return (state, dispatch, view) => {
    const { selection } = state
    if (!(selection instanceof TextSelection) || !selection.empty) return false
    const { $from } = selection
    if (!$from.parent.isTextblock || !atEdge(direction, $from, view)) return false
    if (direction === 'right' && inCode(state)) return false

    // The block that ends (or starts) here may end its parent too: step out to where something is beside it.
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const edge = forward ? $from.after(depth) : $from.before(depth)
      const $edge = state.doc.resolve(edge)
      const next = forward ? $edge.nodeAfter : $edge.nodeBefore
      if (next === null) continue
      if (!isTable(next)) return false
      // Before the table the nearest place for a caret is its first cell, after it its last.
      dispatch?.(state.tr.setSelection(Selection.near($edge, forward ? 1 : -1)).scrollIntoView())
      return true
    }
    return false
  }
}
