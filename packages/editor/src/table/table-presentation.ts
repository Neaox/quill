import { columnClasses, readTableOptions, shapeOfCells } from '@quill/markdown'
import type { TableOptions } from '@quill/markdown'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { AttrStep } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { alignOf } from './table-commands.ts'
import { isTableWrapper, wrapperAttributes } from './table-context.ts'

/**
 * How a table is set while it is written, as the page sets it (ADR-040).
 *
 * The reading surface decides several things about a table from what is in it
 * and from the wrapper's options: a column of numbers is set flush right, a
 * column of identifiers does not break, the first column is a header when the
 * table says so, and the footer's rows are the totals. The renderer writes those
 * as elements (`thead`, `tfoot`, `th scope="row"`) and classes. The editor's
 * rows are one `tbody` of cells ProseMirror owns, so the same decisions are
 * written onto them as decorations, from the same functions, and the editor's
 * stylesheet gives them the page's treatment. Nothing here is in the document.
 */

export interface Presentation {
  readonly from: number
  readonly to: number
  readonly className: string
}

function textOf(cell: PMNode): string {
  return cell.textContent.trim()
}

/** The classes of one table's cells and rows, from its content and its wrapper's options. */
function describe(table: PMNode, tablePos: number, options: TableOptions): Presentation[] {
  const align = alignOf(table)
  const rows: PMNode[] = []
  table.forEach((row) => rows.push(row))
  const headerRow = options.headers !== 'row'
  const rowHeaders = options.headers !== 'column'
  const rest = headerRow ? rows.slice(1) : rows
  const footerStart = rows.length - Math.min(options.footer, rest.length)
  const width = Math.max(...rows.map((row) => row.childCount))
  const shapes = Array.from({ length: width }, (_, column) =>
    shapeOfCells(
      rest.map((row) => (row.maybeChild(column) === null ? '' : textOf(row.child(column)))),
    ),
  )

  const found: Presentation[] = []
  let rowPos = tablePos + 1
  rows.forEach((row, index) => {
    if (index >= footerStart) {
      found.push({ from: rowPos, to: rowPos + row.nodeSize, className: 'table-footer-row' })
    }
    let cellPos = rowPos + 1
    row.forEach((cell, _offset, column) => {
      /* v8 ignore next -- a shape is worked out for every column of the widest row. */
      const classes = columnClasses(align[column], shapes[column] ?? 'text')
      if (index === 0 && headerRow) classes.push('table-column-header')
      else if (column === 0 && rowHeaders) classes.push('table-row-header')
      else if (index === 0) classes.push('table-body-cell')
      found.push({ from: cellPos, to: cellPos + cell.nodeSize, className: classes.join(' ') })
      cellPos += cell.nodeSize
    })
    rowPos += row.nodeSize
  })
  return found
}

/** What every table in the document is given, by position. */
export function presentationOf(doc: PMNode): Presentation[] {
  const found: Presentation[] = []
  doc.descendants((node, pos, parent) => {
    if (node.type.name !== 'table') return !node.isTextblock
    const wrapper = parent !== null && isTableWrapper(parent) ? parent : undefined
    const { options } = readTableOptions(wrapperAttributes(wrapper))
    found.push(...describe(node, pos, options))
    return false
  })
  return found
}

function decorations(found: readonly Presentation[]): Decoration[] {
  return found.map(({ from, to, className }) => Decoration.node(from, to, { class: className }))
}

/** Where a transaction changed the document, in the new document's positions. */
function changedRanges(tr: Transaction): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  tr.steps.forEach((step, index) => {
    const later = tr.mapping.slice(index + 1)
    // An attribute step changes no position, but it is a change to the node it names.
    if (step instanceof AttrStep) {
      const at = later.map(step.pos)
      ranges.push({ from: at, to: at + 1 })
    }
    step.getMap().forEach((_start, _end, from, to) => {
      ranges.push({ from: later.map(from, -1), to: later.map(to, 1) })
    })
  })
  return ranges
}

/** The position of each table a change touched, and of the one in each `:::table` wrapper it touched. */
function touchedTables(doc: PMNode, ranges: readonly { from: number; to: number }[]): Set<number> {
  const tables = new Set<number>()
  for (const { from, to } of ranges) {
    const size = doc.content.size
    doc.nodesBetween(Math.max(0, from - 1), Math.min(size, to + 1), (node, pos) => {
      if (node.type.name === 'table') tables.add(pos)
      else if (isTableWrapper(node)) {
        node.forEach((child, offset) => {
          if (child.type.name === 'table') tables.add(pos + 1 + offset)
        })
      }
      return !node.isTextblock
    })
  }
  return tables
}

/**
 * The decorations after a transaction: the old ones carried along, and the tables
 * the change touched drawn afresh. A keystroke somewhere else in a long document
 * does not walk it (`keystroke-budget.test.tsx`), and one in a table costs that
 * table.
 */
export function updatePresentation(tr: Transaction, decorated: DecorationSet): DecorationSet {
  if (!tr.docChanged) return decorated
  let set = decorated.map(tr.mapping, tr.doc)
  for (const pos of touchedTables(tr.doc, changedRanges(tr))) {
    const table = tr.doc.nodeAt(pos)
    /* v8 ignore next -- `touchedTables` found a table at each position. */
    if (table === null) continue
    set = set.remove(set.find(pos, pos + table.nodeSize))
    const $pos = tr.doc.resolve(pos)
    const wrapper = $pos.parent
    const { options } = readTableOptions(
      wrapperAttributes(isTableWrapper(wrapper) ? wrapper : undefined),
    )
    set = set.add(tr.doc, decorations(describe(table, pos, options)))
  }
  return set
}

export const tablePresentationKey = new PluginKey<DecorationSet>('tablePresentation')

export function createTablePresentationPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: tablePresentationKey,
    state: {
      init: (_config, state) =>
        DecorationSet.create(state.doc, decorations(presentationOf(state.doc))),
      apply: updatePresentation,
    },
    props: {
      decorations: (state) => tablePresentationKey.getState(state),
    },
  })
}

/** Decorates every table's cells and rows as the page sets them. */
export const TablePresentation = Extension.create({
  name: 'tablePresentation',
  addProseMirrorPlugins: () => [createTablePresentationPlugin()],
})
