import { toast } from '@quill/ui'
import { Extension } from '@tiptap/core'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { TableMap } from 'prosemirror-tables'

import { nodeType } from '../schema/node-type.ts'
import { gridFromHtml, gridFromText } from './clipboard-grid.ts'
import type { PastedCell, PastedGrid } from './clipboard-grid.ts'
import { alignOf } from './table-commands.ts'
import { tableContext } from './table-context.ts'

/**
 * Pasting from a spreadsheet (ADR-040, phase 2): a clean GFM table, every
 * merge unwound (`clipboard-grid.ts`), in one transaction and one undo step.
 *
 * Into a table, the grid fills cells from the caret's cell rightwards and
 * down, adding the rows and columns it needs, as a spreadsheet does. Anywhere
 * else it becomes a new table whose first row is its header. A single cell
 * of text is left to the ordinary paste, which already knows what to do with
 * words.
 *
 * It runs before the table library's own paste, which would keep a pasted
 * `colspan` as a merged cell GFM cannot write and a reader cannot sort.
 */

/** Said once when a real merge was split. */
export const UNMERGED_MESSAGE = 'Merged cells were split: a Markdown table has none.'

/** A cell's content: its formatting where it had some, kept to what a line can hold. */
function cellParagraph(schema: Schema, cell: PastedCell): PMNode {
  const paragraph = nodeType(schema, 'paragraph')
  if (cell.element === null) {
    return paragraph.create(null, cell.text === '' ? [] : [schema.text(cell.text)])
  }
  const parsed = ProseMirrorDOMParser.fromSchema(schema).parse(cell.element, {
    topNode: paragraph.create(),
  })
  // Parsed into a paragraph, a cell can only be inline: a line, as GFM needs.
  if (parsed.content.size === 0) return paragraph.create()
  return paragraph.create(null, parsed.content)
}

function cellNode(schema: Schema, header: boolean, content: PMNode): PMNode {
  return nodeType(schema, header ? 'tableHeader' : 'tableCell').create(null, content)
}

/** A new table from a grid: its first row is the header, as GFM's always is. */
export function tableFromGrid(schema: Schema, grid: PastedGrid): PMNode {
  const width = Math.max(...grid.rows.map((row) => row.length))
  const rows = grid.rows.map((row, index) =>
    nodeType(schema, 'tableRow').create(
      null,
      Array.from({ length: width }, (_, column) =>
        cellNode(
          schema,
          index === 0,
          cellParagraph(schema, row[column] ?? { element: null, text: '' }),
        ),
      ),
    ),
  )
  return nodeType(schema, 'table').create(
    { align: Array.from({ length: width }, () => null) },
    rows,
  )
}

/** The table with the grid written into it from (`top`, `left`), grown to hold it. */
function filledTable(
  schema: Schema,
  table: PMNode,
  grid: PastedGrid,
  top: number,
  left: number,
): PMNode {
  const map = TableMap.get(table)
  const height = Math.max(map.height, top + grid.rows.length)
  const width = Math.max(map.width, left + Math.max(...grid.rows.map((row) => row.length)))
  const existing = (row: number, column: number): PMNode | undefined => {
    if (row >= map.height || column >= map.width) return undefined
    const offset = map.map[row * map.width + column]
    return offset === undefined ? undefined : (table.nodeAt(offset) ?? undefined)
  }
  const rows = Array.from({ length: height }, (_row, row) =>
    nodeType(schema, 'tableRow').create(
      null,
      Array.from({ length: width }, (_, column) => {
        const pasted = grid.rows[row - top]?.[column - left]
        if (pasted !== undefined && column >= left) {
          return cellNode(schema, row === 0, cellParagraph(schema, pasted))
        }
        const kept = existing(row, column)
        return kept ?? cellNode(schema, row === 0, nodeType(schema, 'paragraph').create())
      }),
    ),
  )
  const align = Array.from({ length: width }, (_, index) => alignOf(table)[index] ?? null)
  return table.type.create({ ...table.attrs, align }, rows)
}

const CELL_TYPES: ReadonlySet<string> = new Set(['tableCell', 'tableHeader'])

/** The transaction a grid paste makes, or undefined to leave the paste to others. */
export function pasteGrid(state: EditorState, grid: PastedGrid): Transaction | undefined {
  const single = grid.rows.length === 1 && grid.rows[0]?.length === 1
  const context = tableContext(state)
  const { $from } = state.selection
  const inCell = $from.depth > 1 && CELL_TYPES.has($from.node($from.depth - 1).type.name)
  if (context !== undefined && inCell) {
    if (single) return undefined
    const { rect, tablePos, table } = context
    const filled = filledTable(state.schema, table, grid, rect.top, rect.left)
    const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, filled)
    tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 1)))
    return tr.scrollIntoView()
  }
  if (single || context !== undefined) return undefined
  const table = tableFromGrid(state.schema, grid)
  const tr = state.tr.replaceSelectionWith(table)
  return tr.scrollIntoView()
}

export const tablePasteKey = new PluginKey('tablePaste')

/** Reads the clipboard as a grid and pastes it, telling the author when a merge was split. */
export function handleGridPaste(
  state: EditorState,
  data: Pick<DataTransfer, 'getData'> | null,
  dispatch: (tr: Transaction) => void,
  doc: Document,
): boolean {
  const html = data?.getData('text/html') ?? ''
  const grid =
    gridFromHtml(html, doc) ??
    (html === '' ? gridFromText(data?.getData('text/plain') ?? '') : undefined)
  if (grid === undefined) return false
  const tr = pasteGrid(state, grid)
  if (tr === undefined) return false
  dispatch(tr)
  if (grid.unmerged) toast.info(UNMERGED_MESSAGE)
  return true
}

export const TablePaste = Extension.create({
  name: 'tablePaste',
  // Before the table library's paste and the Markdown paste; after the slash menu.
  priority: 1050,
  addProseMirrorPlugins: () => [
    new Plugin({
      key: tablePasteKey,
      props: {
        handlePaste: (view, event) =>
          handleGridPaste(view.state, event.clipboardData, view.dispatch, view.dom.ownerDocument),
      },
    }),
  ],
})
