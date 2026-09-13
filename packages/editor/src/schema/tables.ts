import { Extension } from '@tiptap/core'
import type { Extensions, NodeConfig } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { Command } from '@tiptap/pm/state'
import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  tableEditing,
} from 'prosemirror-tables'

import { nodeType } from './node-type.ts'

/**
 * `prosemirror-tables` over the Markdown package's table nodes.
 *
 * The library recognises a table by a `tableRole` on the node spec and by the
 * span attributes it maintains on cells. Neither belongs in `packages/markdown`:
 * GFM has no merged cells, so the AST has no use for a span, and the package
 * would gain an editing dependency for a field it never reads. Both are added
 * here instead, as an extension wrapper, which leaves the published schema and
 * the converter untouched — a cell created by these commands serialises through
 * `proseMirrorToMdast` exactly like one that came from Markdown.
 */

const TABLE_ROLES: Readonly<Record<string, string>> = {
  table: 'table',
  tableRow: 'row',
  tableCell: 'cell',
  tableHeader: 'header_cell',
}

const CELL_NODES: ReadonlySet<string> = new Set(['tableCell', 'tableHeader'])

/**
 * The span attributes `prosemirror-tables` reads on every cell. GFM cannot
 * express a span, so the defaults are the only values a saved document ever has;
 * they exist because `TableMap` does arithmetic with them on every command.
 */
const CELL_ATTRIBUTES = {
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
}

const TableRoles = Extension.create({
  name: 'tableRoles',
  extendNodeSchema: (extension) => {
    const role = TABLE_ROLES[extension.name]
    return role === undefined ? {} : { tableRole: role }
  },
  addProseMirrorPlugins: () => [tableEditing()],
})

const withCellAttributes: Partial<NodeConfig> = {
  addAttributes() {
    return { ...this.parent?.(), ...CELL_ATTRIBUTES }
  },
}

/** Adds the span attributes to the two cell nodes and registers the roles. */
export function withTables(extensions: Extensions): Extensions {
  const cells = extensions.map((extension) =>
    extension.type === 'node' && CELL_NODES.has(extension.name)
      ? extension.extend(withCellAttributes)
      : extension,
  )
  return [...cells, TableRoles]
}

/**
 * A new table: a header row the author names, and body rows to fill in. Markdown
 * tables always have a header, so the first row is never optional.
 */
export function createTable(schema: Schema, rows: number, columns: number): PMNode {
  const cell = (role: string): PMNode =>
    nodeType(schema, role).create(null, nodeType(schema, 'paragraph').create())
  const row = (role: string): PMNode =>
    nodeType(schema, 'tableRow').create(
      null,
      Array.from({ length: columns }, () => cell(role)),
    )
  return nodeType(schema, 'table').create(null, [
    row('tableHeader'),
    ...Array.from({ length: rows }, () => row('tableCell')),
  ])
}

/** The table commands the block and slash menus offer, named for the menu. */
export const tableCommands = {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  nextCell: goToNextCell(1),
  previousCell: goToNextCell(-1),
} as const satisfies Readonly<Record<string, Command>>
