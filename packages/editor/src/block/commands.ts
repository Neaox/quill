import type { LayoutWidth } from '@quill/markdown'
import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
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

/**
 * What a move moves. `block` is the top-level block, which the block handle,
 * its menu and Ctrl+Shift+Up point at. `item` is what Alt+Up means, as in an
 * outliner: the innermost thing the caret is in, among the blocks beside it.
 * In a list that is the item, with everything nested in it; anywhere else it
 * is the paragraph, heading or other line of text, so a paragraph in a
 * callout, a quote or a details body moves within it. Neither leaves the
 * block that holds it: at the container's edge the key declines, rather than
 * the container jumping a block, which is not what pressing it beside a
 * paragraph means. A table cell is left to the table's own row and column
 * moves, which have the same keys and keep their cells.
 */
export type MoveScope = 'block' | 'item'

const LIST_ITEMS: ReadonlySet<string> = new Set(['listItem', 'taskItem'])

const CELLS: ReadonlySet<string> = new Set(['tableCell', 'tableHeader'])

/**
 * The depth of what `item` moves: the nearest list item around `$pos`, or
 * else the line of text itself; nothing in a table cell. A climb from the
 * caret, never a walk of the document.
 */
function innermostDepth($pos: ResolvedPos): number | undefined {
  if ($pos.depth === 0) return undefined
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name
    if (CELLS.has(name)) return undefined
    if (LIST_ITEMS.has(name)) return depth
  }
  return $pos.depth
}

function isLabel(node: PMNode): boolean {
  return node.attrs['directiveLabel'] === true
}

/** Swaps the node at `depth` with its fellow before or after it; the words keep the caret. */
function moveAt(direction: -1 | 1, depth: number): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection
    // A selection that runs on into another block is not asking to move one.
    if ($from.sharedDepth($to.pos) < depth) return false
    const list = $from.node(depth - 1)
    const index = $from.index(depth - 1)
    const other = list.maybeChild(index + direction)
    const moving = $from.node(depth)
    // A container's title or summary (`[Label]`) is its first line, not a block among the rest.
    if (other === null || isLabel(other) || isLabel(moving)) return false
    const swapped = Fragment.from(direction === 1 ? [other, moving] : [moving, other])
    // A container whose schema fixes its order, a details' summary first, refuses.
    const first = Math.min(index, index + direction)
    if (!list.canReplace(first, first + 2, swapped)) return false
    if (dispatch !== undefined) {
      const before = $from.before(depth)
      const start = direction === 1 ? before : before - other.nodeSize
      const tr = state.tr.replaceWith(start, start + moving.nodeSize + other.nodeSize, swapped)
      const shift = direction * other.nodeSize
      tr.setSelection(TextSelection.create(tr.doc, $from.pos + shift, $to.pos + shift))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Swaps the block with the one before it (-1) or after it (1); see `MoveScope` for which block. */
export function moveBlock(direction: -1 | 1, scope: MoveScope = 'block'): Command {
  const moveTopLevel = moveTopLevelBlock(direction)
  if (scope === 'block') return moveTopLevel
  return (state, dispatch, view) => {
    const { selection } = state
    // A selected block, which is no caret in a line of text, moves as the block it is.
    if (!(selection instanceof TextSelection)) return moveTopLevel(state, dispatch, view)
    const depth = innermostDepth(selection.$from)
    return depth === undefined ? false : moveAt(direction, depth)(state, dispatch)
  }
}

function moveTopLevelBlock(direction: -1 | 1): Command {
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
