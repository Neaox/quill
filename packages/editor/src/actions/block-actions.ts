import type { CommentRequest } from '../block/comment-request.ts'
import { BLOCK_ACTIONS } from '../block/block-state.ts'
import { topLevelBlock } from '../block/commands.ts'
import type { ActionGroup, EditorAction } from './editor-action.ts'

/**
 * The actions every block has: where it sits and who has something to say about
 * it. Its width stays on the block menu (ADR-027), where the three widths are a
 * radio group of their own. They are the block menu's, offered again wherever
 * the author is pointing, so a block can be moved from its own context menu
 * without hunting for the handle.
 */

export const BLOCK_GROUP: ActionGroup = {
  id: 'block',
  label: 'Block',
  actions: BLOCK_ACTIONS.map((action) => ({
    id: action.id,
    label: action.label,
    destructive: action.id === 'delete',
    command: action.command,
  })),
}

/**
 * Raises a comment on the selection, or on the whole block when nothing is
 * selected. Comments are the application's (ADR-022), so this reports the range
 * and stops, and it exists only when somebody is listening.
 */
export function commentAction(
  onComment: ((request: CommentRequest) => void) | undefined,
): EditorAction | undefined {
  if (onComment === undefined) return undefined
  return {
    id: 'comment',
    label: 'Add comment',
    command: (state, dispatch) => {
      const { from, to, empty } = state.selection
      const block = topLevelBlock(state)
      if (block === null) return false
      const range = empty ? { from: block.pos, to: block.pos + block.node.nodeSize } : { from, to }
      if (dispatch !== undefined) {
        onComment({ ...range, text: state.doc.textBetween(range.from, range.to, ' ') })
      }
      return true
    },
  }
}

export function commentGroup(
  onComment: ((request: CommentRequest) => void) | undefined,
): ActionGroup {
  const action = commentAction(onComment)
  return { id: 'comment', label: 'Comment', actions: action === undefined ? [] : [action] }
}
