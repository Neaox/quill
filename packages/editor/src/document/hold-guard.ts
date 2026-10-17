import { Extension } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'

/**
 * A held Backspace or Delete stops at the edge of the block it is erasing.
 *
 * Holding the key is how a line is cleared, and the line is gone when the key reaches its edge.
 * What comes next, left to repeat, is the block beside it: the one before is joined and then eaten
 * word by word, faster than anyone can let go. So an auto-repeated key does nothing at the start
 * (Backspace) or end (Delete) of a block, and the next deliberate press, which is not a repeat,
 * joins as it always has.
 */

/** Whether a repeating key would, here, begin on the block beside the one it has been erasing. */
export function heldKeyAtEdge(event: KeyboardEvent, state: EditorState): boolean {
  if (!event.repeat || (event.key !== 'Backspace' && event.key !== 'Delete')) return false
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const { parentOffset, parent } = selection.$from
  return event.key === 'Backspace' ? parentOffset === 0 : parentOffset === parent.content.size
}

export const HoldStopsAtBlockEdge = Extension.create({
  name: 'holdStopsAtBlockEdge',
  addProseMirrorPlugins: () => [
    new Plugin({ props: { handleKeyDown: (view, event) => heldKeyAtEdge(event, view.state) } }),
  ],
})
