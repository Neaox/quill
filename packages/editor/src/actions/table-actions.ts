import type { Command } from '@tiptap/pm/state'
import { deleteCellSelection, deleteTable } from 'prosemirror-tables'

import {
  addColumn,
  addRow,
  alignOf,
  deleteColumns,
  deleteRows,
  moveColumn,
  moveRow,
  selectLine,
  selectTable,
  setColumnAlign,
  setHeaders,
  setTableAttribute,
  toggleCaption,
  toggleFooter,
} from '../table/table-commands.ts'
import type { ColumnAlign } from '../table/table-commands.ts'
import { tableContext } from '../table/table-context.ts'
import type { TableContext } from '../table/table-context.ts'
import { describeTable } from '../table/table-state.ts'
import type { TableState, TableWidth } from '../table/table-state.ts'
import { COPY_AS_MARKDOWN, COPY_TABLE_AS_MARKDOWN } from './clipboard-actions.ts'
import type { ActionGroup, EditorAction } from './editor-action.ts'

/**
 * The table actions of the context menu, over the table editor's own commands
 * (`table/table-commands.ts`, ADR-040): the same ones the table toolbar and the
 * keyboard use, so a row moved from this menu is moved by the same code, with
 * the same rules about the header row, as one moved by a handle.
 *
 * Those commands take indexes; the menu acts on "the row the caret is in", so
 * each action here reads the selection and hands the command its indexes. That
 * is all this module is: the translation between "this row" and "row 3".
 */

/** Runs `make` with the table the selection is in, or declines when it is in none. */
function inTable(make: (table: TableContext) => Command): Command {
  return (state, dispatch, view) => {
    const table = tableContext(state)
    return table !== undefined && make(table)(state, dispatch, view)
  }
}

/**
 * A move of one line, which is all a move is: the command moves the line the
 * selection starts at, so with several selected it would quietly move only the
 * first. It declines, and the menu shows it unavailable, rather than guess.
 */
function movingOne(
  lines: (context: TableContext) => number,
  move: (context: TableContext) => Command,
): Command {
  return inTable((context) => (lines(context) === 1 ? move(context) : () => false))
}

const rowsOf = ({ rect }: TableContext): number => rect.bottom - rect.top
const columnsOf = ({ rect }: TableContext): number => rect.right - rect.left

function alignment(align: Exclude<ColumnAlign, null>, label: string): EditorAction {
  return {
    id: `align-${align}`,
    label,
    kind: 'radio',
    command: setColumnAlign(align),
    isChecked: (state) => {
      const table = tableContext(state)
      if (table === undefined) return false
      const columns = alignOf(table.table).slice(table.rect.left, table.rect.right)
      return columns.length > 0 && columns.every((each) => each === align)
    },
  }
}

export const TABLE_ROW_GROUP: ActionGroup = {
  id: 'table-rows',
  label: 'Row',
  actions: [
    { id: 'row-above', label: 'Insert row above', command: addRow('before') },
    { id: 'row-below', label: 'Insert row below', command: addRow('after') },
    {
      id: 'row-up',
      label: 'Move row up',
      command: movingOne(rowsOf, ({ rect }) => moveRow(rect.top, rect.top - 1)),
    },
    {
      id: 'row-down',
      label: 'Move row down',
      command: movingOne(rowsOf, ({ rect }) => moveRow(rect.top, rect.top + 1)),
    },
    {
      id: 'row-select',
      label: 'Select row',
      command: inTable(({ rect, tablePos }) => selectLine('row', rect.top, tablePos)),
    },
    { id: 'row-delete', label: 'Delete row', destructive: true, command: deleteRows },
  ],
}

export const TABLE_COLUMN_GROUP: ActionGroup = {
  id: 'table-columns',
  label: 'Column',
  actions: [
    { id: 'column-left', label: 'Insert column left', command: addColumn('before') },
    { id: 'column-right', label: 'Insert column right', command: addColumn('after') },
    {
      id: 'column-move-left',
      label: 'Move column left',
      command: movingOne(columnsOf, ({ rect }) => moveColumn(rect.left, rect.left - 1)),
    },
    {
      id: 'column-move-right',
      label: 'Move column right',
      command: movingOne(columnsOf, ({ rect }) => moveColumn(rect.left, rect.left + 1)),
    },
    {
      id: 'column-select',
      label: 'Select column',
      command: inTable(({ rect, tablePos }) => selectLine('column', rect.left, tablePos)),
    },
    { id: 'column-delete', label: 'Delete column', destructive: true, command: deleteColumns },
  ],
}

/** What can be done with the cells that are selected: copied as they are written, or emptied. */
export const TABLE_CELLS_GROUP: ActionGroup = {
  id: 'table-cells',
  label: 'Cells',
  actions: [
    COPY_AS_MARKDOWN,
    { id: 'cells-clear', label: 'Clear cells', command: deleteCellSelection },
  ],
}

export const TABLE_ALIGN_GROUP: ActionGroup = {
  id: 'table-align',
  label: 'Alignment',
  actions: [
    alignment('left', 'Align left'),
    alignment('center', 'Align centre'),
    alignment('right', 'Align right'),
  ],
}

export const TABLE_WHOLE_GROUP: ActionGroup = {
  id: 'table',
  label: 'Table',
  actions: [
    {
      id: 'table-select',
      label: 'Select table',
      command: inTable(({ tablePos }) => selectTable(tablePos)),
    },
    COPY_TABLE_AS_MARKDOWN,
    { id: 'table-delete', label: 'Delete table', destructive: true, command: deleteTable },
  ],
}

/* --- The table's own options ------------------------------------------------- */

/** Runs `make` with how the table the selection is in is set, or declines when it is in none. */
function withTableState(make: (table: TableState) => Command): Command {
  return (state, dispatch, view) => {
    const table = describeTable(state)
    return table !== null && make(table)(state, dispatch, view)
  }
}

/** A choice of the table's own that is current while `table` says it is. */
function tableChoice(
  action: Omit<EditorAction, 'kind' | 'isChecked'>,
  kind: 'radio' | 'check',
  isCurrent: (table: TableState) => boolean,
): EditorAction {
  return {
    ...action,
    kind,
    isChecked: (state) => {
      const table = describeTable(state)
      return table !== null && isCurrent(table)
    },
  }
}

function widthChoice(width: Exclude<TableWidth, 'custom'>, label: string): EditorAction {
  return tableChoice(
    {
      id: `table-width-${width}`,
      label,
      command: setTableAttribute('width', width === 'wide' ? undefined : width),
    },
    'radio',
    (table) => table.width === width,
  )
}

export const TABLE_WIDTH_GROUP: ActionGroup = {
  id: 'table-width',
  label: 'Width',
  actions: [
    widthChoice('content', 'Content'),
    widthChoice('wide', 'Wide'),
    widthChoice('full', 'Full'),
  ],
}

/** The freeze list with one part switched, as the `freeze` attribute writes it. */
function toggledFreeze(table: TableState, part: 'header' | 'first-column'): string | undefined {
  const parts = new Set<string>([
    ...(table.freezeHeader ? ['header'] : []),
    ...(table.freezeColumn ? ['first-column'] : []),
  ])
  if (!parts.delete(part)) parts.add(part)
  return parts.size === 0 ? undefined : [...parts].join(',')
}

export const TABLE_STRUCTURE_GROUP: ActionGroup = {
  id: 'table-structure',
  label: 'Structure',
  actions: [
    tableChoice(
      {
        id: 'table-header-row',
        label: 'Header row',
        description: 'The first row names the columns',
        command: withTableState((table) =>
          setHeaders({ row: !table.headerRow, column: table.headerColumn }),
        ),
      },
      'check',
      (table) => table.headerRow,
    ),
    tableChoice(
      {
        id: 'table-header-column',
        label: 'Header column',
        description: 'The first column names the rows',
        command: withTableState((table) =>
          setHeaders({ row: table.headerRow, column: !table.headerColumn }),
        ),
      },
      'check',
      (table) => table.headerColumn,
    ),
    tableChoice(
      {
        id: 'table-footer',
        label: 'Footer row',
        description: 'The last row totals or sums up the rest',
        command: toggleFooter,
      },
      'check',
      (table) => table.footer,
    ),
    tableChoice(
      {
        id: 'table-caption',
        label: 'Caption',
        description: 'A line above the table that says what it shows',
        command: toggleCaption,
      },
      'check',
      (table) => table.caption,
    ),
  ],
}

export const TABLE_READING_GROUP: ActionGroup = {
  id: 'table-reading',
  label: 'For readers',
  actions: [
    tableChoice(
      {
        id: 'table-freeze-header',
        label: 'Keep the header in view',
        command: withTableState((table) =>
          setTableAttribute('freeze', toggledFreeze(table, 'header')),
        ),
      },
      'check',
      (table) => table.freezeHeader,
    ),
    tableChoice(
      {
        id: 'table-freeze-column',
        label: 'Keep the first column in view',
        command: withTableState((table) =>
          setTableAttribute('freeze', toggledFreeze(table, 'first-column')),
        ),
      },
      'check',
      (table) => table.freezeColumn,
    ),
    tableChoice(
      {
        id: 'table-stack',
        label: 'Cards on phones',
        description: 'Each row becomes a card on a narrow screen',
        command: withTableState((table) =>
          setTableAttribute('responsive', table.stack ? undefined : 'stack'),
        ),
      },
      'check',
      (table) => table.stack,
    ),
    tableChoice(
      {
        id: 'table-sortable',
        label: 'Readers can sort',
        description: 'Clicking a column heading sorts the rows',
        command: withTableState((table) =>
          setTableAttribute('sort', table.sortable ? 'off' : undefined),
        ),
      },
      'check',
      (table) => table.sortable,
    ),
  ],
}

/** Everything the "Table settings" menu holds, in the order it shows it. */
export const TABLE_OPTION_GROUPS: readonly ActionGroup[] = [
  TABLE_WIDTH_GROUP,
  TABLE_STRUCTURE_GROUP,
  TABLE_READING_GROUP,
]

/* --- What the table toolbar keeps to hand ------------------------------------ */

/** The named actions of a group, in the order given; a name the group lacks is a mistake. */
function pick(group: ActionGroup, ...ids: readonly string[]): readonly EditorAction[] {
  return ids.map((id) => {
    const found = group.actions.find((candidate) => candidate.id === id)
    /* v8 ignore next -- a name the group lacks is a mistake that fails the first time this module loads. */
    if (found === undefined) throw new Error(`The "${group.id}" group has no "${id}" action.`)
    return found
  })
}

/** A row selected: where to put another, and where to put this one. */
export const ROW_TOOLS = pick(TABLE_ROW_GROUP, 'row-above', 'row-below', 'row-up', 'row-down')
export const ROW_REMOVAL = pick(TABLE_ROW_GROUP, 'row-delete')

/** A column selected: the same, sideways. */
export const COLUMN_TOOLS = pick(
  TABLE_COLUMN_GROUP,
  'column-left',
  'column-right',
  'column-move-left',
  'column-move-right',
)
export const COLUMN_REMOVAL = pick(TABLE_COLUMN_GROUP, 'column-delete')

export const TABLE_REMOVAL = pick(TABLE_WHOLE_GROUP, 'table-delete')
