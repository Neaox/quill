import type { ResolvedPos } from '@tiptap/pm/model'
import { TextSelection, type Command } from '@tiptap/pm/state'

import { atEdge, inCode } from './block-edges.ts'

/**
 * Getting out of a block that has the end (or the start) of the document, from the keyboard.
 *
 * A callout, presenter notes, a template block, details: each holds its own paragraphs, and when
 * one is the last thing in the document there is nowhere after it for the caret to go: the arrow
 * keys run out of document and nothing happens, so a keyboard user is shut in (a mouse user clicks
 * below it; there is no below). The same at the top, for one that opens the document. Here the way
 * out is made when it is asked for: the arrow that would leave the block adds an empty line beside
 * it and goes there, and where there is already somewhere to go the key is left to go there.
 *
 * Nothing is added until the key is pressed, so a document that is only read is not changed, and
 * the empty line is the kind the Markdown does not write.
 */

/** Whether `$pos` is in the last child of every block above it: nothing follows it in the document. */
function lastAll($pos: ResolvedPos): boolean {
  for (let depth = 0; depth < $pos.depth; depth += 1) {
    if ($pos.index(depth) !== $pos.node(depth).childCount - 1) return false
  }
  return true
}

/** Whether `$pos` is in the first child of every block above it: nothing precedes it. */
function firstAll($pos: ResolvedPos): boolean {
  for (let depth = 0; depth < $pos.depth; depth += 1) {
    if ($pos.index(depth) !== 0) return false
  }
  return true
}

/** Adds an empty paragraph at `at`, if the document may have one there, and puts the caret in it. */
function addLineAt(
  state: Parameters<Command>[0],
  dispatch: Parameters<Command>[1],
  at: number,
): boolean {
  const paragraph = state.schema.nodes['paragraph']?.createAndFill()
  /* v8 ignore next -- the schema has a paragraph, and the document takes one between any two blocks. */
  if (paragraph === undefined || paragraph === null) return false
  const index = state.doc.resolve(at).index()
  /* v8 ignore next */
  if (!state.doc.canReplaceWith(index, index, paragraph.type)) return false
  if (dispatch !== undefined) {
    const tr = state.tr.insert(at, paragraph)
    tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView()
    dispatch(tr)
  }
  return true
}

/**
 * Down and Right at the end of a block that ends the document: a line after it.
 * `down` leaves from anywhere on the last line, as the key would move on from there.
 */
export function leaveEnd(direction: 'down' | 'right'): Command {
  return (state, dispatch, view) => {
    const { selection } = state
    if (!(selection instanceof TextSelection) || !selection.empty) return false
    const { $from } = selection
    // A paragraph that is itself the last thing has a document's end to go to already.
    if (!$from.parent.isTextblock || $from.depth < 2 || !lastAll($from)) return false
    if (direction === 'right' && inCode(state)) return false
    if (!atEdge(direction, $from, view)) return false
    return addLineAt(state, dispatch, $from.after(1))
  }
}

/** Up and Left at the start of a block that opens the document: a line before it. */
export function leaveStart(direction: 'up' | 'left'): Command {
  return (state, dispatch, view) => {
    const { selection } = state
    if (!(selection instanceof TextSelection) || !selection.empty) return false
    const { $from } = selection
    if (!$from.parent.isTextblock || $from.depth < 2 || !firstAll($from)) return false
    if (!atEdge(direction, $from, view)) return false
    return addLineAt(state, dispatch, $from.before(1))
  }
}
