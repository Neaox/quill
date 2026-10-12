import { readTableOptions } from '@quill/markdown'
import type { EditorState } from '@tiptap/pm/state'

import { alignOf, captionOf, footerOf, headersOf } from './table-commands.ts'
import type { ColumnAlign } from './table-commands.ts'
import { tableContext, wrapperAttributes } from './table-context.ts'

/**
 * What the table the selection is in is set to, as plain values: the one place
 * the toolbar's checks, its radio choices and its menus read it from, so what
 * a control shows is always what the Markdown says.
 */

export type TableWidth = 'content' | 'wide' | 'full' | 'custom'

export interface TableState {
  readonly width: TableWidth
  readonly headerRow: boolean
  readonly headerColumn: boolean
  readonly footer: boolean
  readonly caption: boolean
  /** The alignment every selected column shares, `null` for none, or `'mixed'`. */
  readonly align: ColumnAlign | 'mixed'
  readonly freezeHeader: boolean
  readonly freezeColumn: boolean
  readonly stack: boolean
  readonly sortable: boolean
}

function widthOf(width: unknown): TableWidth {
  if (width === undefined || width === 'wide') return 'wide'
  return width === 'content' || width === 'full' ? width : 'custom'
}

/** The state of the table the selection is in, or null outside one. */
export function describeTable(state: EditorState): TableState | null {
  const context = tableContext(state)
  if (context === undefined) return null
  const { options } = readTableOptions(wrapperAttributes(context.wrapper?.node))
  const headers = headersOf(context)
  const { left, right } = context.rect
  const alignments = alignOf(context.table).slice(left, right)
  const [first = null] = alignments
  const freeze = options.freeze === 'auto' ? [] : options.freeze
  return {
    width: widthOf(options.width),
    headerRow: headers.row,
    headerColumn: headers.column,
    footer: footerOf(context) > 0,
    caption: captionOf(context) !== undefined,
    align: alignments.every((each) => each === first) ? first : 'mixed',
    freezeHeader: freeze.includes('header'),
    freezeColumn: freeze.includes('first-column'),
    stack: options.responsive === 'stack',
    sortable: options.sortable,
  }
}
