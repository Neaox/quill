import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'

import { calloutAt } from '../callout/callouts.ts'
import { linkAt } from '../format/links.ts'
import { CellSelection } from 'prosemirror-tables'

import { selectedLines, tableContext, wholeTableSelected } from '../table/table-context.ts'
import type { CommentRequest } from '../block/comment-request.ts'
import { BLOCK_GROUP, commentGroup } from './block-actions.ts'
import { CALLOUT_GROUP, CALLOUT_VARIANT_GROUP, CALLOUT_WRAP_GROUP } from './callout-actions.ts'
import { CLIPBOARD_GROUP } from './clipboard-actions.ts'
import { availableGroups } from './editor-action.ts'
import type { ActionGroup } from './editor-action.ts'
import { linkTargetAt } from '../link/link-display.ts'
import { linkGroup } from './link-actions.ts'
import { LINK_DISPLAY_GROUP } from './link-display-actions.ts'
import type { LinkUi } from './link-actions.ts'
import {
  TABLE_ALIGN_GROUP,
  TABLE_CELLS_GROUP,
  TABLE_COLUMN_GROUP,
  TABLE_ROW_GROUP,
  TABLE_WHOLE_GROUP,
} from './table-actions.ts'
import { MARK_GROUP, STYLE_GROUP } from './text-actions.ts'

/**
 * What the context menu offers, decided by where the author pointed.
 *
 * The menu is *context aware* in the plainest sense: it is a function of the
 * editor state. Text that is selected gets formatting and a link; a table gets
 * its row, column and alignment actions; a callout gets its variants; and every
 * block can be moved, duplicated, deleted and commented on. Each rule is a line
 * below, so a new kind of block gets its own section by adding one.
 *
 * Groups with nothing the author can do right now are left out, rather than shown
 * as a block of disabled items: a menu that lists what is impossible is noise.
 */

export interface ContextMenuUi extends LinkUi {
  readonly onComment?: ((request: CommentRequest) => void) | undefined
}

/** Whether a stretch of text, rather than a cell or a node, is selected. */
function hasSelectedText(state: EditorState): boolean {
  return state.selection instanceof TextSelection && !state.selection.empty
}

/** A group with its own name, some of its actions left out, and some named differently, by id. */
function adapted(
  group: ActionGroup,
  {
    label,
    without = [],
    names = {},
  }: {
    readonly label?: string
    readonly without?: readonly string[]
    readonly names?: Readonly<Record<string, string>>
  },
): ActionGroup {
  return {
    ...group,
    label: label ?? group.label,
    actions: group.actions
      .filter((action) => !without.includes(action.id))
      .map((action) => {
        const named = names[action.id]
        return named === undefined ? action : { ...action, label: named }
      }),
  }
}

/**
 * What the table's menu holds for what is selected of it, so that everything in it
 * is about what the author has selected and nothing is there to be greyed out:
 *
 * - A caret is pointing at a cell: its row, its column, their alignment, the table.
 * - Whole rows are pointing at rows: where to put another, where to move them,
 *   whether they stay. A column's alignment or insertion is not about them.
 * - Whole columns are the same, sideways, with their alignment.
 * - The whole table is pointing at the table: its cells and the table itself. A
 *   row or a column would be a guess, and "Delete rows" would mean all of them.
 * - Any other patch of cells is pointing at those cells, and at the rows and
 *   columns they span.
 *
 * More than one row or column is named in the plural and cannot be "moved", which
 * would move only the first. A selection says what it is already, so "Select row"
 * and "Select table" are offered only to a caret.
 */
function tableGroups(state: EditorState): ActionGroup[] {
  const context = tableContext(state)
  /* v8 ignore next -- only called where there is a table. */
  if (context === undefined) return []
  const { selection } = state
  const cells = selection instanceof CellSelection
  const lines = selectedLines(context, selection)
  const whole = wholeTableSelected(context, selection)
  const rows = context.rect.bottom - context.rect.top
  const columns = context.rect.right - context.rect.left

  const rowsGroup = adapted(TABLE_ROW_GROUP, {
    label: rows > 1 ? 'Rows' : 'Row',
    without: [...(cells ? ['row-select'] : []), ...(rows > 1 ? ['row-up', 'row-down'] : [])],
    names: rows > 1 ? { 'row-delete': 'Delete rows' } : {},
  })
  const columnsGroup = adapted(TABLE_COLUMN_GROUP, {
    label: columns > 1 ? 'Columns' : 'Column',
    without: [
      ...(cells ? ['column-select'] : []),
      ...(columns > 1 ? ['column-move-left', 'column-move-right'] : []),
    ],
    names: columns > 1 ? { 'column-delete': 'Delete columns' } : {},
  })
  const tableGroup = adapted(TABLE_WHOLE_GROUP, {
    // Selected whole, the cells' own "Copy as Markdown" is the table's already.
    without: whole ? ['table-select', 'copy-table-markdown'] : cells ? ['table-select'] : [],
  })

  return [
    ...(cells ? [TABLE_CELLS_GROUP] : []),
    ...(whole || lines?.axis === 'column' ? [] : [rowsGroup]),
    ...(whole || lines?.axis === 'row' ? [] : [columnsGroup]),
    ...(lines?.axis === 'row' ? [] : [TABLE_ALIGN_GROUP]),
    tableGroup,
  ]
}

export function contextMenuGroups(state: EditorState, ui: ContextMenuUi): readonly ActionGroup[] {
  const selectedText = hasSelectedText(state)
  const table = tableContext(state) !== undefined
  const callout = calloutAt(state) !== null

  // With something selected there is something to cut and copy, and paste replaces it;
  // with only a caret the keyboard's paste and the browser's own menu (Shift + right-click) do.
  const groups: ActionGroup[] = state.selection.empty ? [] : [CLIPBOARD_GROUP]
  if (selectedText || linkAt(state) !== null) groups.push(linkGroup(ui))
  if (linkTargetAt(state) !== null) groups.push(LINK_DISPLAY_GROUP)
  if (selectedText) groups.push(MARK_GROUP)
  if (table) {
    groups.push(...tableGroups(state))
  } else {
    // A cell holds one line of inline text, so there is nothing to turn it into.
    groups.push(STYLE_GROUP)
  }
  if (callout) groups.push(CALLOUT_VARIANT_GROUP, CALLOUT_GROUP)
  else if (selectedText) groups.push(CALLOUT_WRAP_GROUP)
  groups.push(BLOCK_GROUP, commentGroup(ui.onComment))

  return availableGroups(groups, state)
}
