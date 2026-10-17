import type { EditorView } from '@tiptap/pm/view'

import type { Box } from './toolbar-position.ts'

/**
 * The box words from `from` to `to` take up on screen, for what floats over
 * them — the selection toolbar, the link popover. On one line, the words'
 * own box; over several, the column they are in, from the first line's top
 * to the last line's bottom.
 */
export function selectionBox(view: EditorView, from: number, to: number): Box {
  const start = view.coordsAtPos(from, 1)
  const end = view.coordsAtPos(to, -1)
  if (start.top === end.top) {
    return { top: start.top, bottom: end.bottom, left: start.left, right: end.right }
  }
  const column = view.dom.getBoundingClientRect()
  return { top: start.top, bottom: end.bottom, left: column.left, right: column.right }
}
