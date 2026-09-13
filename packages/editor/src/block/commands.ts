import type { LayoutWidth } from '@quill/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'

/**
 * What a block menu does, as commands.
 *
 * Every entry acts on the top-level block the selection is in, because that is
 * the thing an author points at: the paragraph, the table, the code block. The
 * commands are ProseMirror commands and know nothing about a menu, so the same
 * behaviour is reachable from a keyboard binding, a test, or a future drag
 * handle without being written twice.
 */

export interface BlockRef {
  readonly node: PMNode
  /** The position immediately before the block. */
  readonly pos: number
  /** Its index among the document's top-level blocks. */
  readonly index: number
}

/** The top-level block holding the selection, which is the menu's subject. */
export function topLevelBlock(state: EditorState): BlockRef | null {
  const { selection } = state
  if (selection instanceof NodeSelection && selection.$from.depth === 0) {
    return { node: selection.node, pos: selection.from, index: selection.$from.index(0) }
  }
  const $from = selection.$from
  if ($from.depth === 0) return null
  return { node: $from.node(1), pos: $from.before(1), index: $from.index(0) }
}

function withBlock(act: (block: BlockRef, state: EditorState) => Command): Command {
  return (state, dispatch, view) => {
    const block = topLevelBlock(state)
    if (block === null) return false
    return act(block, state)(state, dispatch, view)
  }
}

/** Whether a block can carry a width at all (ADR-027 lists the types that can). */
export function supportsWidth(node: PMNode): boolean {
  const attrs = node.type.spec.attrs
  return attrs !== undefined && Object.hasOwn(attrs, 'layout')
}

export function blockWidth(node: PMNode): LayoutWidth {
  const layout = node.attrs['layout']
  return layout === 'wide' || layout === 'full' ? layout : 'content'
}

/**
 * Sets a block's width. `content` is the default and is stored as no attribute at
 * all, so a document that never leaves the reading measure gains no wrappers when
 * it is written back.
 */
export function setBlockWidth(width: LayoutWidth): Command {
  return withBlock((block) => (state, dispatch) => {
    if (!supportsWidth(block.node)) return false
    const value = width === 'content' ? null : width
    if (block.node.attrs['layout'] === value) return false
    dispatch?.(state.tr.setNodeAttribute(block.pos, 'layout', value))
    return true
  })
}

/** Swaps the block with the one before it (-1) or after it (1). */
export function moveBlock(direction: -1 | 1): Command {
  return withBlock((block) => (state, dispatch) => {
    const sibling = state.doc.maybeChild(block.index + direction)
    if (sibling === null) return false
    const target = direction < 0 ? block.pos - sibling.nodeSize : block.pos + sibling.nodeSize
    const tr = state.tr.delete(block.pos, block.pos + block.node.nodeSize)
    tr.insert(target, block.node)
    dispatch?.(tr.setSelection(Selection.near(tr.doc.resolve(target))).scrollIntoView())
    return true
  })
}

export const duplicateBlock: Command = withBlock((block) => (state, dispatch) => {
  const after = block.pos + block.node.nodeSize
  const tr = state.tr.insert(after, block.node)
  dispatch?.(tr.setSelection(Selection.near(tr.doc.resolve(after))).scrollIntoView())
  return true
})

export const deleteBlock: Command = withBlock((block) => (state, dispatch) => {
  if (state.doc.childCount === 1) return false
  dispatch?.(state.tr.delete(block.pos, block.pos + block.node.nodeSize).scrollIntoView())
  return true
})
