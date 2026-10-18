import { readTableOptions } from '@quill/markdown'
import type { Command, EditorState } from '@tiptap/pm/state'
import { deleteTable } from 'prosemirror-tables'

import {
  addColumn,
  addRow,
  alignOf,
  captionOf,
  deleteColumns,
  deleteRows,
  footerOf,
  headersOf,
  moveColumn,
  moveRow,
  setColumnAlign,
  setHeaders,
  setTableAttribute,
  toggleCaption,
  toggleFooter,
} from './table-commands.ts'
import type { ColumnAlign } from './table-commands.ts'
import { tableContext, wrapperAttributes } from './table-context.ts'

/**
 * Everything that can be done to the table the caret is in (ADR-040, phase
 * 2), as one catalogue (registry pattern): each action has its words, its
 * key binding when it has one, whether it is on, why it cannot run now, and
 * the command that runs it. The table toolbar draws it, the keymap binds it,
 * and a context menu or command palette lists it, so the three never
 * disagree about what an action is called, what its shortcut is, or when it
 * is unavailable.
 */

/** What the actions need to know about the table, compared by value between renders. */
export interface TableState {
  readonly key: string
  readonly width: 'content' | 'wide' | 'full' | 'custom'
  readonly headerRow: boolean
  readonly headerColumn: boolean
  readonly footer: boolean
  readonly caption: boolean
  readonly align: ColumnAlign | 'mixed'
  /** The selection's rows and columns, first and last. */
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly rows: number
  readonly columns: number
  readonly freezeHeader: boolean
  readonly freezeColumn: boolean
  readonly stack: boolean
  readonly sortable: boolean
  readonly tablePos: number
}

/** The state of the table the selection is in, or null outside one. */
export function describeTable(state: EditorState): TableState | null {
  const context = tableContext(state)
  if (context === undefined) return null
  const { options } = readTableOptions(wrapperAttributes(context.wrapper?.node))
  const headers = headersOf(context)
  const { rect, map } = context
  const aligns = Array.from(
    { length: rect.right - rect.left },
    (_, index) => alignOf(context.table)[rect.left + index] ?? null,
  )
  const align = aligns.every((each) => each === aligns[0]) ? (aligns[0] ?? null) : 'mixed'
  const freeze = options.freeze === 'auto' ? [] : options.freeze
  const width =
    options.width === undefined || options.width === 'wide'
      ? 'wide'
      : typeof options.width === 'string'
        ? options.width
        : 'custom'
  const described: Omit<TableState, 'key'> = {
    width,
    headerRow: headers.row,
    headerColumn: headers.column,
    footer: footerOf(context) > 0,
    caption: captionOf(context) !== undefined,
    align,
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    rows: map.height,
    columns: map.width,
    freezeHeader: freeze.includes('header'),
    freezeColumn: freeze.includes('first-column'),
    stack: options.responsive === 'stack',
    sortable: options.sortable,
    tablePos: context.tablePos,
  }
  return { ...described, key: JSON.stringify(described) }
}

export type TableActionSection =
  | 'insert'
  | 'delete'
  | 'move'
  | 'parts'
  | 'align'
  | 'width'
  | 'reading'
  | 'table'

export interface TableAction {
  readonly id: string
  readonly label: string
  readonly section: TableActionSection
  /** The ProseMirror key it is bound to, when it has one: `Mod-Alt-ArrowUp`. */
  readonly key?: string
  /** Whether it is on, for an action that is a setting. */
  pressed?(table: TableState): boolean
  /** Why it cannot run on this table now; undefined when it can. */
  unavailable?(table: TableState): string | undefined
  command(table: TableState): Command
}

/** The freeze list with one part turned on or off, as the attribute writes it. */
function toggledFreeze(table: TableState, part: 'header' | 'first-column'): string | undefined {
  const parts = new Set<string>([
    ...(table.freezeHeader ? ['header'] : []),
    ...(table.freezeColumn ? ['first-column'] : []),
  ])
  if (parts.has(part)) parts.delete(part)
  else parts.add(part)
  return parts.size === 0 ? undefined : [...parts].join(',')
}

/** Moves the selection's first row or column one place, as dragging its grip does. */
function moveBy(axis: 'row' | 'column', by: number): (table: TableState) => Command {
  return (table) => {
    const from = axis === 'row' ? table.top : table.left
    return (axis === 'row' ? moveRow : moveColumn)(from, from + by, table.tablePos)
  }
}

const ONE_HEADER = 'A table keeps at least one header'

function widthAction(value: 'content' | 'wide' | 'full', label: string): TableAction {
  return {
    id: `width-${value}`,
    label,
    section: 'width',
    pressed: (table) => table.width === value,
    command: () => setTableAttribute('width', value === 'wide' ? undefined : value),
  }
}

function alignAction(value: ColumnAlign, label: string): TableAction {
  return {
    id: `align-${value ?? 'auto'}`,
    label,
    section: 'align',
    pressed: (table) => table.align === value,
    command: () => setColumnAlign(value),
  }
}

export const TABLE_ACTIONS: readonly TableAction[] = [
  {
    id: 'row-above',
    label: 'Insert row above',
    section: 'insert',
    key: 'Mod-Alt-ArrowUp',
    unavailable: (table) =>
      table.top === 0 && table.headerRow ? 'Nothing goes above the header row' : undefined,
    command: () => addRow('before'),
  },
  {
    id: 'row-below',
    label: 'Insert row below',
    section: 'insert',
    key: 'Mod-Alt-ArrowDown',
    command: () => addRow('after'),
  },
  {
    id: 'column-left',
    label: 'Insert column left',
    section: 'insert',
    key: 'Mod-Alt-ArrowLeft',
    command: () => addColumn('before'),
  },
  {
    id: 'column-right',
    label: 'Insert column right',
    section: 'insert',
    key: 'Mod-Alt-ArrowRight',
    command: () => addColumn('after'),
  },
  {
    id: 'move-row-up',
    label: 'Move row up',
    section: 'move',
    key: 'Alt-ArrowUp',
    unavailable: (table) =>
      table.top === 0
        ? 'Already the first row'
        : table.top === 1 && table.headerRow
          ? 'The header row stays first'
          : undefined,
    command: moveBy('row', -1),
  },
  {
    id: 'move-row-down',
    label: 'Move row down',
    section: 'move',
    key: 'Alt-ArrowDown',
    unavailable: (table) =>
      table.top === 0 && table.headerRow
        ? 'The header row stays first'
        : table.top === table.rows - 1
          ? 'Already the last row'
          : undefined,
    command: moveBy('row', 1),
  },
  {
    id: 'move-column-left',
    label: 'Move column left',
    section: 'move',
    key: 'Alt-ArrowLeft',
    unavailable: (table) => (table.left === 0 ? 'Already the first column' : undefined),
    command: moveBy('column', -1),
  },
  {
    id: 'move-column-right',
    label: 'Move column right',
    section: 'move',
    key: 'Alt-ArrowRight',
    unavailable: (table) =>
      table.left === table.columns - 1 ? 'Already the last column' : undefined,
    command: moveBy('column', 1),
  },
  {
    id: 'delete-row',
    label: 'Delete row',
    section: 'delete',
    key: 'Mod-Alt-Backspace',
    unavailable: (table) =>
      // A GFM table's first row is structural: it is the header, written or not.
      table.top === 0
        ? table.headerRow
          ? 'The header row cannot be deleted'
          : 'The first row cannot be deleted'
        : table.bottom - table.top >= table.rows - 1
          ? 'A table keeps at least one row under the first'
          : undefined,
    command: () => deleteRows,
  },
  {
    id: 'delete-column',
    label: 'Delete column',
    section: 'delete',
    key: 'Mod-Alt-Shift-Backspace',
    unavailable: (table) =>
      table.right - table.left >= table.columns ? 'A table keeps at least one column' : undefined,
    command: () => deleteColumns,
  },
  {
    id: 'header-row',
    label: 'Header row',
    section: 'parts',
    pressed: (table) => table.headerRow,
    unavailable: (table) => (table.headerRow && !table.headerColumn ? ONE_HEADER : undefined),
    command: (table) => setHeaders({ row: !table.headerRow, column: table.headerColumn }),
  },
  {
    id: 'header-column',
    label: 'Header column',
    section: 'parts',
    pressed: (table) => table.headerColumn,
    unavailable: (table) => (table.headerColumn && !table.headerRow ? ONE_HEADER : undefined),
    command: (table) => setHeaders({ row: table.headerRow, column: !table.headerColumn }),
  },
  {
    id: 'footer-row',
    label: 'Footer row',
    section: 'parts',
    pressed: (table) => table.footer,
    unavailable: (table) =>
      !table.footer && table.rows < 3
        ? 'Add a row first: the header row cannot be the footer'
        : undefined,
    command: () => toggleFooter,
  },
  {
    id: 'caption',
    label: 'Caption',
    section: 'parts',
    pressed: (table) => table.caption,
    command: () => toggleCaption,
  },
  alignAction('left', 'Align left'),
  alignAction('center', 'Align centre'),
  alignAction('right', 'Align right'),
  alignAction(null, 'Align automatically'),
  widthAction('content', 'Content width'),
  widthAction('wide', 'Wide'),
  widthAction('full', 'Full width'),
  {
    id: 'freeze-header',
    label: 'Freeze header row',
    section: 'reading',
    pressed: (table) => table.freezeHeader,
    command: (table) => setTableAttribute('freeze', toggledFreeze(table, 'header')),
  },
  {
    id: 'freeze-column',
    label: 'Freeze first column',
    section: 'reading',
    pressed: (table) => table.freezeColumn,
    command: (table) => setTableAttribute('freeze', toggledFreeze(table, 'first-column')),
  },
  {
    id: 'stack',
    label: 'Cards on phones',
    section: 'reading',
    pressed: (table) => table.stack,
    command: (table) => setTableAttribute('responsive', table.stack ? undefined : 'stack'),
  },
  {
    id: 'sort',
    label: 'Readers can sort',
    section: 'reading',
    pressed: (table) => table.sortable,
    command: (table) => setTableAttribute('sort', table.sortable ? 'off' : undefined),
  },
  {
    id: 'delete-table',
    label: 'Delete table',
    section: 'table',
    command: () => deleteTable,
  },
]

/** One action as it stands for the table the caret is in. */
export interface ResolvedTableAction {
  readonly id: string
  readonly label: string
  readonly section: TableActionSection
  readonly key: string | undefined
  readonly pressed: boolean | undefined
  readonly unavailable: string | undefined
  /** Runs the action; refuses, like any command, when it is unavailable. */
  readonly command: Command
}

export function resolveAction(action: TableAction, table: TableState): ResolvedTableAction {
  const unavailable = action.unavailable?.(table)
  const command = action.command(table)
  return {
    id: action.id,
    label: action.label,
    section: action.section,
    key: action.key,
    pressed: action.pressed?.(table),
    unavailable,
    command: unavailable === undefined ? command : () => false,
  }
}

/** The table actions for the table the selection is in; none outside a table. */
export function tableActions(state: EditorState): readonly ResolvedTableAction[] {
  const table = describeTable(state)
  if (table === null) return []
  return TABLE_ACTIONS.map((action) => resolveAction(action, table))
}

/** The action by its id, resolved for the table the selection is in. */
export function tableAction(state: EditorState, id: string): ResolvedTableAction | undefined {
  return tableActions(state).find((action) => action.id === id)
}

/** The bound actions, by key: each declines outside a table, so the key goes on to whatever else it does. */
export function tableKeymap(): Readonly<Record<string, Command>> {
  return Object.fromEntries(
    TABLE_ACTIONS.flatMap((action) =>
      action.key === undefined
        ? []
        : [
            [
              action.key,
              ((state, dispatch) => {
                const table = describeTable(state)
                return table !== null && resolveAction(action, table).command(state, dispatch)
              }) satisfies Command,
            ],
          ],
    ),
  )
}
