import { serializeDocument } from '@quill/markdown'
import { Extension } from '@tiptap/core'
import type { Node as PMNode, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { documentToMdast } from '../document/ast.ts'

/**
 * What a copy of cells carries beside the cells themselves (ADR-040).
 *
 * A selection of cells copies as an HTML table, which is what a spreadsheet or
 * a word processor wants. The plain-text flavour the editor would otherwise
 * make is every cell on a line of its own, which is neither a table nor a
 * paste anyone could use; it is tabs between cells and a line between rows
 * instead, which is what a text editor, a terminal and a spreadsheet's own
 * paste all read as a grid. "Copy as Markdown" is the table as it is written.
 */

/**
 * The table a slice of selected cells holds, or undefined for anything else.
 * A whole table is a table; part of one is its rows, which are put in a table
 * of their own so that every copy of cells is read the same way.
 */
export function tableOfSlice(slice: Slice): PMNode | undefined {
  const { content } = slice
  const first = content.firstChild
  if (first === null) return undefined
  if (content.childCount === 1 && first.type.name === 'table') return first
  const table = first.type.schema.nodes['table']
  return table !== undefined && first.type.name === 'tableRow'
    ? table.create(null, content)
    : undefined
}

/** A cell's words on one line: a tab or a line break inside it would break the grid. */
function lineOf(cell: PMNode): string {
  return cell.textContent.replaceAll(/\s+/gu, ' ').trim()
}

/** Tabs between cells and a line between rows. */
export function tsvOfTable(table: PMNode): string {
  const rows: string[] = []
  table.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => cells.push(lineOf(cell)))
    rows.push(cells.join('\t'))
  })
  return rows.join('\n')
}

/** The table as Markdown, its first row the header, as a GFM table must have one. */
export function markdownOfTable(table: PMNode): string {
  const doc = table.type.schema.topNodeType.create(null, table)
  return serializeDocument({ frontMatter: {}, ast: documentToMdast(doc).tree })
}

export const tableCopyKey = new PluginKey('tableCopy')

/** Gives a copy of cells its tab-separated plain text. */
export const TableCopy = Extension.create({
  name: 'tableCopy',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: tableCopyKey,
      props: {
        clipboardTextSerializer: (slice) => {
          const table = tableOfSlice(slice)
          return table === undefined ? '' : tsvOfTable(table)
        },
      },
    }),
  ],
})
