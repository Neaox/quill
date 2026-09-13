import { LAYOUT_WIDTHS } from '@quill/markdown'
import type { LayoutWidth } from '@quill/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Command, EditorState } from '@tiptap/pm/state'

import {
  blockWidth,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  supportsWidth,
  topLevelBlock,
} from './commands.ts'

/**
 * What the block menu shows, derived from the editor state and nothing else.
 *
 * Each action reports its own availability by being run without a dispatch,
 * which is how a ProseMirror command answers "would this do anything?". The menu
 * therefore never carries a second copy of the rules about when a block can move
 * up or be deleted.
 */

export interface BlockAction {
  readonly id: string
  readonly label: string
  readonly command: Command
}

/** The order the design puts them in: move, duplicate, then the destructive one. */
export const BLOCK_ACTIONS: readonly BlockAction[] = [
  { id: 'move-up', label: 'Move up', command: moveBlock(-1) },
  { id: 'move-down', label: 'Move down', command: moveBlock(1) },
  { id: 'duplicate', label: 'Duplicate', command: duplicateBlock },
  { id: 'delete', label: 'Delete', command: deleteBlock },
]

export const BLOCK_WIDTHS: readonly LayoutWidth[] = LAYOUT_WIDTHS

const WIDTH_LABELS: Readonly<Record<LayoutWidth, string>> = {
  content: 'Content',
  wide: 'Wide',
  full: 'Full',
}

export function widthLabel(width: LayoutWidth): string {
  return WIDTH_LABELS[width]
}

function humanise(name: string): string {
  const spaced = name.replaceAll(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** What the author calls this block. A directive is known by its own name. */
export function blockLabel(node: PMNode): string {
  const directiveName = node.attrs['name']
  if (node.type.name.endsWith('Directive') && typeof directiveName === 'string') {
    return humanise(directiveName)
  }
  return humanise(node.type.name)
}

export interface BlockMenuState {
  /** Changes exactly when the menu's appearance should; nothing else re-renders it. */
  readonly key: string
  readonly label: string
  readonly width: LayoutWidth
  readonly pos: number
  readonly from: number
  readonly to: number
  readonly canSetWidth: boolean
  readonly enabled: Readonly<Record<string, boolean>>
}

export function describeBlockMenu(state: EditorState): BlockMenuState | null {
  const block = topLevelBlock(state)
  if (block === null) return null
  const enabled = Object.fromEntries(
    BLOCK_ACTIONS.map((action) => [action.id, action.command(state)]),
  )
  const width = blockWidth(block.node)
  const canSetWidth = supportsWidth(block.node)
  return {
    key: [block.pos, block.node.type.name, width, canSetWidth, JSON.stringify(enabled)].join('|'),
    label: blockLabel(block.node),
    width,
    pos: block.pos,
    from: block.pos,
    to: block.pos + block.node.nodeSize,
    canSetWidth,
    enabled,
  }
}
