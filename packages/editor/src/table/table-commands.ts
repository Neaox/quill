import { readTableOptions } from '@quill/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeRange } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'
import { liftTarget } from '@tiptap/pm/transform'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  deleteColumn,
  deleteRow,
  goToNextCell,
  moveTableColumn,
  moveTableRow,
  TableMap,
} from 'prosemirror-tables'

import { nodeType } from '../schema/node-type.ts'
import type { TableContext } from './table-context.ts'
import { tableAt, tableContext, wrapperAttributes } from './table-context.ts'

/**
 * The table editor's commands (ADR-040, phase 2). Each is one ProseMirror
 * command, so one transaction and one undo step, and so the same behaviour
 * serves the toolbar, the handles, the keyboard and a test.
 *
 * A GFM table has invariants the generic table library does not know: the
 * first row is the header row, every cell is one line, and the delimiter
 * row's alignment has one entry per column. Every structural command ends by
 * restoring them (`normalise`), and keeps the `:::table` wrapper's column
 * proportions in step with the columns they describe.
 */

export type ColumnAlign = 'left' | 'center' | 'right' | null

/** Runs `command`, then lets `fix` restore the table's invariants in the same transaction. */
function thenFix(command: Command, fix: (tr: Transaction, before: TableContext) => void): Command {
  return (state, dispatch) => {
    const before = tableContext(state)
    if (before === undefined) return false
    if (dispatch === undefined) return command(state)
    let captured: Transaction | undefined
    const ran = command(state, (tr) => {
      captured = tr
    })
    if (!ran || captured === undefined) return false
    fix(captured, before)
    normalise(captured, before.tablePos)
    dispatch(captured.scrollIntoView())
    return true
  }
}

/**
 * The GFM invariants, restored after any change to a table's shape: the
 * first row's cells are header cells and no other row's are, and the
 * alignment list has exactly one entry per column.
 */
export function normalise(tr: Transaction, tablePos: number): void {
  const table = tr.doc.nodeAt(tablePos)
  /* v8 ignore next -- every caller passes the position of a table it has just changed. */
  if (table === null || table.type.name !== 'table') return
  const header = nodeType(tr.doc.type.schema, 'tableHeader')
  const cell = nodeType(tr.doc.type.schema, 'tableCell')
  table.forEach((row, rowOffset, rowIndex) => {
    row.forEach((child, cellOffset) => {
      const wanted = rowIndex === 0 ? header : cell
      if (child.type !== wanted) {
        tr.setNodeMarkup(tablePos + 1 + rowOffset + 1 + cellOffset, wanted, child.attrs)
      }
    })
  })
  const width = TableMap.get(table).width
  const align = alignOf(table)
  if (align.length !== width) {
    const fixed = Array.from({ length: width }, (_, index) => align[index] ?? null)
    tr.setNodeAttribute(tablePos, 'align', fixed)
  }
}

/** A table's column alignments, as GFM's delimiter row holds them. */
export function alignOf(table: PMNode): readonly ColumnAlign[] {
  const align: unknown = table.attrs['align']
  if (!Array.isArray(align)) return []
  return align.map((each: unknown) =>
    each === 'left' || each === 'center' || each === 'right' ? each : null,
  )
}

/* --- The wrapper's attributes ---------------------------------------------- */

/** The wrapper's column proportions, when it has valid ones for this many columns. */
function proportions(context: TableContext): number[] | undefined {
  const { options } = readTableOptions(wrapperAttributes(context.wrapper?.node))
  const columns = options.columns
  return columns !== undefined && columns.length === context.map.width ? [...columns] : undefined
}

function writeProportions(values: readonly number[]): string {
  return values.map((each) => `${Math.round(each * 100) / 100}fr`).join(' ')
}

/**
 * Sets (or with `undefined`, removes) one of the `:::table` wrapper's
 * attributes, wrapping the table in one when it has none, and unwrapping it
 * when nothing is left to say, so the Markdown stays a plain table until an
 * option is chosen. Every other attribute is kept as written.
 */
export function setTableAttribute(name: string, value: string | undefined): Command {
  return setTableAttributeAt(undefined, name, value)
}

/** `setTableAttribute` for the table at `tablePos`, wherever the selection is (a handle). */
export function setTableAttributeAt(
  tablePos: number | undefined,
  name: string,
  value: string | undefined,
): Command {
  return (state, dispatch) => {
    const context = tablePos === undefined ? tableContext(state) : tableAt(state, tablePos)
    if (context === undefined) return false
    const current = wrapperAttributes(context.wrapper?.node)
    if (current[name] === value) return false
    if (dispatch === undefined) return true
    const tr = state.tr
    applyAttribute(tr, context, name, value)
    dispatch(tr)
    return true
  }
}

/** The `setTableAttribute` change, applied to a transaction already under way. */
export function applyAttribute(
  tr: Transaction,
  context: TableContext,
  name: string,
  value: string | undefined,
): void {
  const attributes = { ...wrapperAttributes(context.wrapper?.node) }
  if (value === undefined) delete attributes[name]
  else attributes[name] = value
  const wrapperPos = ensureWrapper(tr, context)
  tr.setNodeAttribute(wrapperPos, 'attributes', attributes)
  unwrapIfEmpty(tr, wrapperPos)
}

/** The wrapper's position, wrapping the table in a new `:::table` when it has none. */
function ensureWrapper(tr: Transaction, context: TableContext): number {
  if (context.wrapper !== undefined) return tr.mapping.map(context.wrapper.pos)
  const tablePos = tr.mapping.map(context.tablePos)
  const $from = tr.doc.resolve(tablePos)
  const $to = tr.doc.resolve(tablePos + context.table.nodeSize)
  const range = new NodeRange($from, $to, $from.depth)
  tr.wrap(range, [
    {
      type: nodeType(tr.doc.type.schema, 'containerDirective'),
      attrs: { name: 'table', attributes: {} },
    },
  ])
  return tablePos
}

/** Takes the table out of a wrapper that has no attributes and no caption left. */
function unwrapIfEmpty(tr: Transaction, wrapperPos: number): void {
  const wrapper = tr.doc.nodeAt(wrapperPos)
  /* v8 ignore next -- `ensureWrapper` has just put it there. */
  if (wrapper === null) return
  if (Object.keys(wrapperAttributes(wrapper)).length > 0 || wrapper.childCount !== 1) return
  const $from = tr.doc.resolve(wrapperPos + 1)
  const $to = tr.doc.resolve(wrapperPos + wrapper.nodeSize - 1)
  const range = $from.blockRange($to)
  const target = range === null ? null : liftTarget(range)
  if (range !== null && target !== null) tr.lift(range, target)
}

/** Header row and header column, as GFM and the `headers` attribute can say them. */
export interface Headers {
  readonly row: boolean
  readonly column: boolean
}

export function headersOf(context: TableContext): Headers {
  const { options } = readTableOptions(wrapperAttributes(context.wrapper?.node))
  return { row: options.headers !== 'row', column: options.headers !== 'column' }
}

/**
 * Sets which headers the table has. A table keeps at least one: with neither,
 * it would have no names at all, so that is refused rather than guessed.
 */
export function setHeaders(headers: Headers): Command {
  if (!headers.row && !headers.column) return () => false
  const value = headers.row ? (headers.column ? 'both' : undefined) : 'row'
  return setTableAttribute('headers', value)
}

/** The number of footer rows the table has. */
export function footerOf(context: TableContext): number {
  return readTableOptions(wrapperAttributes(context.wrapper?.node)).options.footer
}

/** Turns the footer row on (the last row) or off. */
export const toggleFooter: Command = (state, dispatch) => {
  const context = tableContext(state)
  if (context === undefined) return false
  const on = footerOf(context) > 0
  // A footer needs a row above it that is not the header.
  if (!on && context.map.height < 3) return false
  return setTableAttribute('footer', on ? undefined : '1')(state, dispatch)
}

/** The wrapper's caption paragraph, when it has one. */
export function captionOf(context: TableContext): PMNode | undefined {
  const first = context.wrapper?.node.firstChild
  return first?.type.name === 'paragraph' && first.attrs['directiveLabel'] === true
    ? first
    : undefined
}

/**
 * Adds a caption line above the table, with its prompt selected so typing
 * replaces it, or takes it away again.
 */
export const toggleCaption: Command = (state, dispatch) => {
  const context = tableContext(state)
  if (context === undefined) return false
  if (dispatch === undefined) return true
  const tr = state.tr
  const caption = captionOf(context)
  if (caption !== undefined && context.wrapper !== undefined) {
    const at = context.wrapper.pos + 1
    tr.delete(at, at + caption.nodeSize)
    unwrapIfEmpty(tr, context.wrapper.pos)
    dispatch(tr)
    return true
  }
  const wrapperPos = ensureWrapper(tr, context)
  const schema = state.schema
  const paragraph = nodeType(schema, 'paragraph').create(
    { directiveLabel: true },
    schema.text('Caption'),
  )
  tr.insert(wrapperPos + 1, paragraph)
  tr.setSelection(TextSelection.create(tr.doc, wrapperPos + 2, wrapperPos + 2 + 'Caption'.length))
  dispatch(tr.scrollIntoView())
  return true
}

/* --- Rows and columns --------------------------------------------------------- */

/** Every column the selection touches. */
function selectedColumns(context: TableContext): number[] {
  return Array.from(
    { length: context.rect.right - context.rect.left },
    (_, index) => context.rect.left + index,
  )
}

/** Sets the alignment of the selected columns, which GFM keeps in the delimiter row. */
export function setColumnAlign(align: ColumnAlign): Command {
  return (state, dispatch) => {
    const context = tableContext(state)
    if (context === undefined) return false
    const current = [...alignOf(context.table)]
    const columns = selectedColumns(context)
    if (columns.every((column) => (current[column] ?? null) === align)) return false
    if (dispatch === undefined) return true
    const next = Array.from({ length: context.map.width }, (_, index) =>
      columns.includes(index) ? align : (current[index] ?? null),
    )
    dispatch(state.tr.setNodeAttribute(context.tablePos, 'align', next))
    return true
  }
}

/** Inserts a column beside the selection, its alignment unset and its share the average. */
export function addColumn(side: 'before' | 'after'): Command {
  return thenFix(side === 'before' ? addColumnBefore : addColumnAfter, (tr, before) => {
    const at = side === 'before' ? before.rect.left : before.rect.right
    const align = [...alignOf(before.table)]
    align.splice(at, 0, null)
    tr.setNodeAttribute(before.tablePos, 'align', align)
    const shares = proportions(before)
    if (shares !== undefined) {
      shares.splice(at, 0, shares.reduce((sum, each) => sum + each, 0) / shares.length)
      writeColumns(tr, before, shares)
    }
  })
}

/** Inserts a row above or below the selection. The header row stays the first. */
export function addRow(side: 'before' | 'after'): Command {
  return (state, dispatch) => {
    const context = tableContext(state)
    if (context === undefined) return false
    // Nothing goes above the header row: GFM's first row is always the header.
    if (side === 'before' && context.rect.top === 0 && headersOf(context).row) return false
    return thenFix(side === 'before' ? addRowBefore : addRowAfter, () => undefined)(state, dispatch)
  }
}

/** Deletes the selected columns, with their alignments and shares. */
export const deleteColumns: Command = (state, dispatch) => {
  const context = tableContext(state)
  if (context === undefined || context.rect.right - context.rect.left >= context.map.width) {
    return false
  }
  return thenFix(deleteColumn, (tr, before) => {
    const removed = selectedColumns(before)
    const keep = (_: unknown, index: number): boolean => !removed.includes(index)
    tr.setNodeAttribute(before.tablePos, 'align', alignOf(before.table).filter(keep))
    const shares = proportions(before)
    if (shares !== undefined) writeColumns(tr, before, shares.filter(keep))
  })(state, dispatch)
}

/** Deletes the selected rows. The header row is never deleted: GFM needs it. */
export const deleteRows: Command = (state, dispatch) => {
  const context = tableContext(state)
  if (context === undefined) return false
  if (context.rect.top === 0 || context.rect.bottom - context.rect.top >= context.map.height - 1) {
    return false
  }
  return thenFix(deleteRow, () => undefined)(state, dispatch)
}

function writeColumns(tr: Transaction, before: TableContext, shares: readonly number[]): void {
  const context = { ...before, wrapper: before.wrapper }
  applyAttribute(tr, context, 'columns', shares.length === 0 ? undefined : writeProportions(shares))
}

/**
 * Moves row `from` to index `to`. The header row stays put, and nothing is
 * moved into its place, unless the table's rows are its only headers.
 */
export function moveRow(from: number, to: number, tablePos?: number): Command {
  return (state, dispatch) => {
    const context = tablePos === undefined ? tableContext(state) : tableAt(state, tablePos)
    if (context === undefined || from === to) return false
    if (from < 0 || to < 0 || from >= context.map.height || to >= context.map.height) return false
    if (headersOf(context).row && (from === 0 || to === 0)) return false
    if (dispatch === undefined) return true
    let captured: Transaction | undefined
    moveTableRow({ from, to, pos: context.tablePos + 1, select: true })(state, (tr) => {
      captured = tr
    })
    /* v8 ignore next -- the move was checked above, so the library always makes it. */
    if (captured === undefined) return false
    normalise(captured, context.tablePos)
    dispatch(captured.scrollIntoView())
    return true
  }
}

/** Moves column `from` to index `to`, with its alignment and its share. */
export function moveColumn(from: number, to: number, tablePos?: number): Command {
  return (state, dispatch) => {
    const context = tablePos === undefined ? tableContext(state) : tableAt(state, tablePos)
    if (context === undefined || from === to) return false
    if (from < 0 || to < 0 || from >= context.map.width || to >= context.map.width) return false
    if (dispatch === undefined) return true
    let captured: Transaction | undefined
    moveTableColumn({ from, to, pos: context.tablePos + 1, select: true })(state, (tr) => {
      captured = tr
    })
    /* v8 ignore next -- the move was checked above, so the library always makes it. */
    if (captured === undefined) return false
    const move = <T>(values: readonly T[]): T[] => {
      const next = [...values]
      const [moved] = next.splice(from, 1)
      if (moved !== undefined) next.splice(to, 0, moved)
      return next
    }
    captured.setNodeAttribute(context.tablePos, 'align', move(alignOf(context.table)))
    const shares = proportions(context)
    if (shares !== undefined) writeColumns(captured, context, move(shares))
    normalise(captured, context.tablePos)
    dispatch(captured.scrollIntoView())
    return true
  }
}

/** Selects a whole row or column, as a grip does. */
export function selectLine(kind: 'row' | 'column', index: number, tablePos: number): Command {
  return (state, dispatch) => {
    const context = tableAt(state, tablePos)
    if (context === undefined) return false
    const { map } = context
    const limit = kind === 'row' ? map.height : map.width
    if (index < 0 || index >= limit) return false
    if (dispatch === undefined) return true
    const start = context.tablePos + 1
    const first = kind === 'row' ? map.map[index * map.width] : map.map[index]
    const last =
      kind === 'row'
        ? map.map[index * map.width + map.width - 1]
        : map.map[(map.height - 1) * map.width + index]
    /* v8 ignore next -- a grid with this row or column has both corners. */
    if (first === undefined || last === undefined) return false
    dispatch(state.tr.setSelection(CellSelection.create(state.doc, start + first, start + last)))
    return true
  }
}

/** Selects every cell of a table, as the handle on its corner does, so it can be copied, cut or cleared whole. */
export function selectTable(tablePos: number): Command {
  return (state, dispatch) => {
    const context = tableAt(state, tablePos)
    if (context === undefined) return false
    if (dispatch === undefined) return true
    const { map } = context
    const start = context.tablePos + 1
    const first = map.map[0]
    const last = map.map[map.map.length - 1]
    /* v8 ignore next -- a table has a first and a last cell. */
    if (first === undefined || last === undefined) return false
    dispatch(state.tr.setSelection(CellSelection.create(state.doc, start + first, start + last)))
    return true
  }
}

/**
 * A row or column inserted so that it becomes line `at` (a "+" on the border
 * between `at - 1` and `at`), with the caret in its first cell, ready to type.
 * The insertion commands work beside the selection, so the line before the
 * border is picked first; the whole is one transaction and one undo step.
 */
export function insertLine(kind: 'row' | 'column', at: number, tablePos: number): Command {
  return (state, dispatch) => {
    const context = tableAt(state, tablePos)
    if (context === undefined) return false
    const lines = kind === 'row' ? context.map.height : context.map.width
    if (at < 0 || at > lines) return false
    // The header row stays first (see `addRow`).
    if (kind === 'row' && at === 0 && headersOf(context).row) return false
    let picked: EditorState | undefined
    selectLine(
      kind,
      Math.max(0, at - 1),
      tablePos,
    )(state, (tr) => {
      picked = state.apply(tr)
    })
    /* v8 ignore next -- the border has a line beside it, and the table is where it was. */
    if (picked === undefined) return false
    const add =
      kind === 'row'
        ? addRow(at === 0 ? 'before' : 'after')
        : addColumn(at === 0 ? 'before' : 'after')
    if (dispatch === undefined) return add(picked)
    return add(picked, (tr) => {
      const table = tr.doc.nodeAt(tablePos)
      const map = table === null ? undefined : TableMap.get(table)
      const offset = map?.map[kind === 'row' ? at * map.width : at]
      if (offset !== undefined) {
        tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 1 + offset + 1)))
      }
      dispatch(tr)
    })
  }
}

/* --- The keyboard ----------------------------------------------------------- */

/** Whether the selection is in the table's last cell. */
function inLastCell(state: EditorState, context: TableContext): boolean {
  return (
    context.rect.bottom === context.map.height &&
    context.rect.right === context.map.width &&
    state.selection.empty
  )
}

/**
 * Alt+Shift+Arrow: the cell beside this one in that direction, the caret at its start, however far
 * into its text the caret was. The arrow keys alone go a character at a time and Ctrl+Arrow a word
 * at a time, so across a row there is otherwise no quick way; Tab goes the way of the reading order
 * and wraps. At the table's edge nothing moves, and the key is still spent: left to the browser it
 * would extend a selection by a word, which is not what anyone pressing it in a grid wants.
 */
export function goToCell(direction: 'up' | 'down' | 'left' | 'right'): Command {
  return (state, dispatch) => {
    const context = tableContext(state)
    if (context === undefined) return false
    const { rect, map } = context
    const row = direction === 'up' ? rect.top - 1 : direction === 'down' ? rect.bottom : rect.top
    const column =
      direction === 'left' ? rect.left - 1 : direction === 'right' ? rect.right : rect.left
    const offset =
      row < 0 || row >= map.height || column < 0 || column >= map.width
        ? undefined
        : map.map[row * map.width + column]
    if (offset !== undefined && dispatch !== undefined) {
      const start = context.tablePos + 1 + offset + 1
      dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(start))).scrollIntoView())
    }
    return true
  }
}

/** Tab: the next cell, and in the last cell a new row, as a spreadsheet does. */
export const nextCellOrNewRow: Command = (state, dispatch) => {
  const context = tableContext(state)
  if (context === undefined) return false
  if (inLastCell(state, context)) return addRowAndGo(state, dispatch, context, 0)
  return goToNextCell(1)(state, dispatch)
}

/**
 * Enter in a cell: a GFM cell is one line, so Enter goes to the cell below,
 * and in the last row adds a row and goes there. Shift+Enter is a line break.
 */
export const enterInTable: Command = (state, dispatch) => {
  const context = tableContext(state)
  if (context === undefined || !(state.selection instanceof TextSelection)) return false
  const { rect, map } = context
  // In the last row: a new row below, the caret in its first cell from the
  // last cell (as Tab does), or in the same column from any other.
  if (rect.bottom === map.height) {
    return addRowAndGo(state, dispatch, context, inLastCell(state, context) ? 0 : rect.left)
  }
  // The cell below, its line's end.
  const below = map.map[rect.bottom * map.width + rect.left]
  /* v8 ignore next -- a row below the selection has a cell in its column. */
  if (below === undefined) return false
  if (dispatch === undefined) return true
  const cellPos = context.tablePos + 1 + below
  const cell = state.doc.nodeAt(cellPos)
  /* v8 ignore next -- the map points at a cell. */
  if (cell === null) return false
  dispatch(
    state.tr
      .setSelection(TextSelection.near(state.doc.resolve(cellPos + cell.nodeSize - 1), -1))
      .scrollIntoView(),
  )
  return true
}

/** A row at the end, and the caret in its cell in `column`: one transaction. */
function addRowAndGo(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  context: TableContext,
  column: number,
): boolean {
  if (dispatch === undefined) return true
  let captured: Transaction | undefined
  addRowAfter(state, (tr) => {
    captured = tr
  })
  /* v8 ignore next -- in a table, a row can always be added. */
  if (captured === undefined) return false
  normalise(captured, context.tablePos)
  const table = captured.doc.nodeAt(context.tablePos)
  /* v8 ignore next -- the table is where it was. */
  if (table === null) return false
  const map = TableMap.get(table)
  const offset = map.map[(map.height - 1) * map.width + column]
  /* v8 ignore next -- the new row has a cell in every column. */
  if (offset === undefined) return false
  captured.setSelection(TextSelection.near(captured.doc.resolve(context.tablePos + 1 + offset + 1)))
  dispatch(captured.scrollIntoView())
  return true
}
