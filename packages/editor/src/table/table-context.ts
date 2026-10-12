import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Selection } from '@tiptap/pm/state'
import { CellSelection, isInTable, selectedRect, TableMap } from 'prosemirror-tables'
import type { TableRect } from 'prosemirror-tables'

/**
 * The table the selection is in, as the table editor works with it (ADR-040,
 * phase 2): the GFM table node, and the `:::table` wrapper around it when
 * there is one, which holds the reading options and the caption.
 *
 * A GFM table is a grid with no merged cells, so a column is an index and a
 * row is an index; the wrapper's attributes are strings, exactly as the
 * Markdown holds them.
 */
export interface TableContext {
  readonly table: PMNode
  /** The position before the table node. */
  readonly tablePos: number
  readonly map: TableMap
  /** The selected cells' rectangle, in the grid's rows and columns. */
  readonly rect: TableRect
  /** The `:::table` wrapper, when the table has one. */
  readonly wrapper: { readonly node: PMNode; readonly pos: number } | undefined
}

/** The `:::table` wrapper's attributes, as strings. */
export function wrapperAttributes(wrapper: PMNode | undefined): Readonly<Record<string, string>> {
  const attributes: unknown = wrapper?.attrs['attributes']
  if (typeof attributes !== 'object' || attributes === null) return {}
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [name, value === null ? '' : String(value)]),
  )
}

/** Whether a node is a `:::table` wrapper. */
export function isTableWrapper(node: PMNode): boolean {
  return node.type.name === 'containerDirective' && node.attrs['name'] === 'table'
}

/** The table the selection is in, or undefined. */
export function tableContext(state: EditorState): TableContext | undefined {
  // In a table's caption, the table is the one its wrapper holds.
  if (!isInTable(state)) return captionTable(state)
  const rect = selectedRect(state)
  const tablePos = rect.tableStart - 1
  const $table = state.doc.resolve(tablePos)
  const parent = $table.parent
  const wrapper =
    $table.depth > 0 && isTableWrapper(parent) ? { node: parent, pos: $table.before() } : undefined
  return { table: rect.table, tablePos, map: rect.map, rect, wrapper }
}

/** The table whose wrapper the selection is in, outside the table itself: its caption. */
function captionTable(state: EditorState): TableContext | undefined {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (isTableWrapper(node)) {
      let found: number | undefined
      node.forEach((child, offset) => {
        if (child.type.name === 'table') found = $from.before(depth) + 1 + offset
      })
      return found === undefined ? undefined : tableAt(state, found)
    }
  }
  return undefined
}

/** The context of the table at `tablePos`, whatever the selection. */
export function tableAt(state: EditorState, tablePos: number): TableContext | undefined {
  const table = state.doc.nodeAt(tablePos)
  if (table === null || table.type.name !== 'table') return undefined
  const map = TableMap.get(table)
  const $table = state.doc.resolve(tablePos)
  const parent = $table.parent
  const wrapper =
    $table.depth > 0 && isTableWrapper(parent) ? { node: parent, pos: $table.before() } : undefined
  return {
    table,
    tablePos,
    map,
    rect: {
      left: 0,
      top: 0,
      right: map.width,
      bottom: map.height,
      tableStart: tablePos + 1,
      map,
      table,
    },
    wrapper,
  }
}

/** Rows or columns `from` up to, not including, `to`, selected whole. */
export interface LineSelection {
  readonly axis: 'row' | 'column'
  readonly from: number
  readonly to: number
}

/**
 * The whole rows or columns the cell selection covers, which is what a grip
 * selects; undefined for a caret, for a patch of cells, and for the whole table.
 */
export function selectedLines(
  context: TableContext,
  selection: Selection,
): LineSelection | undefined {
  if (!(selection instanceof CellSelection)) return undefined
  const { top, bottom, left, right } = context.rect
  const wholeColumns = top === 0 && bottom === context.map.height
  const wholeRows = left === 0 && right === context.map.width
  if (wholeColumns === wholeRows) return undefined
  return wholeColumns
    ? { axis: 'column', from: left, to: right }
    : { axis: 'row', from: top, to: bottom }
}

/** Whether every cell of the table is selected, as the handle on its corner selects them. */
export function wholeTableSelected(context: TableContext, selection: Selection): boolean {
  const { top, bottom, left, right } = context.rect
  return (
    selection instanceof CellSelection &&
    top === 0 &&
    left === 0 &&
    bottom === context.map.height &&
    right === context.map.width
  )
}

/** What the author is pointing at in a table: the table, or one row or column of it. */
export type TableScope = 'table' | 'row' | 'column'

export function tableScope(context: TableContext, selection: Selection): TableScope {
  return selectedLines(context, selection)?.axis ?? 'table'
}
