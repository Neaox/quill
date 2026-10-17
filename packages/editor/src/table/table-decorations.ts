import { columnClasses, readTableOptions, shapeOf } from '@quill/markdown'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { AttrStep } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { isInTable, selectedRect, TableMap } from 'prosemirror-tables'

import { alignOf } from './table-commands.ts'
import { isTableWrapper, wrapperAttributes } from './table-context.ts'

/**
 * A table written as it is read (ADR-040, phase 2). `prosemirror-tables`
 * draws every row in one `tbody`, so what the renderer says with `thead`,
 * `tfoot`, `th scope="row"` and a column's classes is said here with
 * decorations the reading stylesheet also reads:
 *
 * - the header row, `data-part="head"`; footer rows, `data-part="foot"`;
 * - a row header (`headers=row|both`), `data-part="row-header"`;
 * - every cell, its column's classes (`columnClasses`): the author's
 *   alignment, else `align-numeric` for numbers, and its shape;
 * - the table the caret is in, `data-active`, which keeps its handles shown.
 *
 * Only the tables a transaction touched are decorated again, so typing in a
 * long document costs one table's cells, not every table's.
 */

const key = new PluginKey<DecorationSet>('tableDecorations')

/** A table's options as its wrapper holds them, or the defaults for a bare table. */
function optionsOf(doc: PMNode, tablePos: number): { headers: string; footer: number } {
  const $table = doc.resolve(tablePos)
  const wrapper = $table.depth > 0 && isTableWrapper($table.parent) ? $table.parent : undefined
  const { headers, footer } = readTableOptions(wrapperAttributes(wrapper)).options
  return { headers, footer }
}

/** The decorations of one table, which starts at `tablePos`. */
export function tableDecorations(doc: PMNode, table: PMNode, tablePos: number): Decoration[] {
  const { headers, footer } = optionsOf(doc, tablePos)
  const headRow = headers !== 'row'
  const rowHeaders = headers !== 'column'
  const rows: PMNode[] = []
  table.forEach((row) => rows.push(row))
  // A footer needs a body row above it, as the renderer's does.
  const footFrom = footer > 0 && rows.length - footer > 1 ? rows.length - footer : rows.length
  const body = rows.slice(headRow ? 1 : 0)
  const align = alignOf(table)
  const classes = Array.from({ length: TableMap.get(table).width }, (_, column) =>
    columnClasses(
      align[column],
      /* v8 ignore next -- a GFM row has a cell in every column. */
      shapeOf(body.map((row) => row.maybeChild(column)?.textContent ?? '')),
    ).join(' '),
  )
  const decorations: Decoration[] = []
  let rowPos = tablePos + 1
  rows.forEach((row, index) => {
    const part = index === 0 && headRow ? 'head' : index >= footFrom ? 'foot' : undefined
    if (part !== undefined) {
      decorations.push(Decoration.node(rowPos, rowPos + row.nodeSize, { 'data-part': part }))
    }
    let cellPos = rowPos + 1
    row.forEach((cell, _offset, column) => {
      const rowHeader = rowHeaders && column === 0 && part !== 'head'
      const attributes: Record<string, string> = {}
      /* v8 ignore next -- there is a class list for every column. */
      const columnClass = classes[column] ?? ''
      if (columnClass !== '') attributes['class'] = columnClass
      if (rowHeader) attributes['data-part'] = 'row-header'
      if (Object.keys(attributes).length > 0) {
        decorations.push(Decoration.node(cellPos, cellPos + cell.nodeSize, attributes))
      }
      cellPos += cell.nodeSize
    })
    rowPos += row.nodeSize
  })
  return decorations
}

/** Every table in a range of the document, with its position. */
function tablesIn(doc: PMNode, from: number, to: number): Map<number, PMNode> {
  const tables = new Map<number, PMNode>()
  const clampedFrom = Math.max(0, Math.min(from, doc.content.size))
  const clampedTo = Math.max(clampedFrom, Math.min(to, doc.content.size))
  // The tables around each end: a change inside a cell is a change to its table.
  for (const pos of [clampedFrom, clampedTo]) {
    const $pos = doc.resolve(pos)
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth)
      if (node.type.name === 'table') tables.set($pos.before(depth), node)
    }
  }
  doc.nodesBetween(clampedFrom, clampedTo, (node, pos) => {
    if (node.type.name === 'table') {
      tables.set(pos, node)
      return false
    }
    return !node.isTextblock
  })
  return tables
}

/** The ranges of the new document a transaction changed, wrapper attributes included. */
function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = []
  tr.steps.forEach((step, index) => {
    const after = tr.mapping.slice(index + 1)
    if (step instanceof AttrStep) {
      const pos = after.map(step.pos)
      const node = tr.doc.nodeAt(pos)
      /* v8 ignore next -- an attribute step names a node that is there. */
      ranges.push([pos, pos + (node?.nodeSize ?? 0)])
      return
    }
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([after.map(newStart, -1), after.map(newEnd, 1)])
    })
  })
  return ranges
}

function decorateAll(doc: PMNode): DecorationSet {
  const decorations = [...tablesIn(doc, 0, doc.content.size)].flatMap(([pos, table]) =>
    tableDecorations(doc, table, pos),
  )
  return DecorationSet.create(doc, decorations)
}

function redecorate(set: DecorationSet, tr: Transaction): DecorationSet {
  let next = set.map(tr.mapping, tr.doc)
  const touched = new Map<number, PMNode>()
  for (const [from, to] of changedRanges(tr)) {
    for (const [pos, table] of tablesIn(tr.doc, from, to)) touched.set(pos, table)
  }
  for (const [pos, table] of touched) {
    next = next
      .remove(next.find(pos, pos + table.nodeSize))
      .add(tr.doc, tableDecorations(tr.doc, table, pos))
  }
  return next
}

/** The table the selection is in, marked so its handles stay shown while the pointer is elsewhere. */
function activeTable(state: EditorState): Decoration[] {
  if (!isInTable(state)) return []
  const { tableStart, table } = selectedRect(state)
  return [Decoration.node(tableStart - 1, tableStart - 1 + table.nodeSize, { 'data-active': '' })]
}

export const TableDecorations = Extension.create({
  name: 'tableDecorations',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => decorateAll(state.doc),
          apply: (tr, set) => (tr.docChanged ? redecorate(set, tr) : set),
        },
        props: {
          decorations(state) {
            /* v8 ignore next -- the plugin's state is there from the editor's start. */
            const set = key.getState(state) ?? DecorationSet.empty
            const active = activeTable(state)
            return active.length === 0 ? set : set.add(state.doc, active)
          },
        },
      }),
    ]
  },
})
