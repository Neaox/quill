import type { ResolvedPos } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export type Direction = 'up' | 'down' | 'left' | 'right'

/**
 * Whether the caret is where `direction` would take it out of its textblock: the end for down and
 * right, the start for up and left. Down and up are asked of the browser, which knows which line
 * the caret is on; a command run with no view to ask, as a menu does to see whether it could run,
 * takes the edge of the text for the edge.
 */
export function atEdge(direction: Direction, $pos: ResolvedPos, view: EditorView | undefined) {
  const forward = direction === 'down' || direction === 'right'
  const atBoundary = forward
    ? $pos.parentOffset === $pos.parent.content.size
    : $pos.parentOffset === 0
  if (direction === 'left' || direction === 'right' || view === undefined) return atBoundary
  return view.endOfTextblock(direction)
}

/** The caret is inside inline code, whose end is for the key to step out of first. */
export function inCode(state: EditorState): boolean {
  const marks = state.storedMarks ?? state.selection.$from.marks()
  return marks.some((mark) => mark.type.spec.code === true)
}
