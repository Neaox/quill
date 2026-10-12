import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { nodeType } from '../schema/node-type.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { setTableAttribute } from './table-commands.ts'
import {
  createTablePresentationPlugin,
  presentationOf,
  tablePresentationKey,
} from './table-presentation.ts'

const harness = createEditorTestHarness()

const TABLE = [
  '| Region | Requests | Budget |',
  '| - | -: | - |',
  '| eu-west-1 | 12,400 | 200 ms |',
  '| us-east-1 | 9,850 | 300 ms |',
  '| Total | 22,250 | |',
  '',
].join('\n')

/** The classes each cell of a table is given, by row and column, as the page gives them. */
function cellClasses(source: string): string[][] {
  const doc = harness.state(source).doc
  const classes = new Map<number, string>()
  for (const { from, className } of presentationOf(doc)) classes.set(from, className)
  const rows: string[][] = []
  doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'tableRow') return true
    const cells: string[] = []
    node.forEach((cell, offset) => {
      cells.push(classes.get(pos + 1 + offset) ?? '')
    })
    rows.push(cells)
    return false
  })
  return rows
}

/** The classes each row is given. */
function rowClasses(source: string): string[] {
  const doc = harness.state(source).doc
  const classes = new Map<number, string>()
  for (const { from, className } of presentationOf(doc)) classes.set(from, className)
  const rows: string[] = []
  doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'tableRow') return true
    rows.push(classes.get(pos) ?? '')
    return false
  })
  return rows
}

describe('how a table’s cells are set while it is written', () => {
  it('sets a column of numbers flush right in tabular figures, and the author’s alignment first', () => {
    const [header, first] = cellClasses(TABLE)

    // `Requests` is aligned right by its author; `Budget` is numbers with units.
    expect(header?.[1]).toContain('align-right')
    expect(header?.[2]).toContain('align-numeric')
    expect(first?.[2]).toContain('align-numeric')
    expect(first?.[0]).not.toContain('align-')
  })

  it('keeps a column of identifiers on one line', () => {
    const [, first] = cellClasses(TABLE)

    expect(first?.[0]).toContain('column-nowrap')
  })

  it('gives running text room, as the page does', () => {
    const long = `| Name | About |\n| - | - |\n| a | ${'word '.repeat(12)} |\n`

    expect(cellClasses(long)[1]?.[1]).toContain('column-long')
  })

  it('draws the first row’s cells as column headers, and nothing else', () => {
    const [header, first] = cellClasses(TABLE)

    expect(header?.every((each) => each.includes('table-column-header'))).toBe(true)
    expect(first?.some((each) => each.includes('table-column-header'))).toBe(false)
  })

  it('draws the first column of the rows as row headers when the table says so', () => {
    const both = cellClasses(`:::table{headers="both"}\n${TABLE}:::\n`)

    expect(both[0]?.[0]).toContain('table-column-header')
    expect(both.slice(1).map((row) => row[0]?.includes('table-row-header'))).toEqual([
      true,
      true,
      true,
    ])
    expect(both[1]?.[1]).not.toContain('table-row-header')
  })

  it('draws the rows as the headers, with no header row, when the rows alone are headers', () => {
    const rows = cellClasses(`:::table{headers="row"}\n${TABLE}:::\n`)

    expect(rows.flat().some((each) => each.includes('table-column-header'))).toBe(false)
    expect(rows.map((row) => row[0]?.includes('table-row-header'))).toEqual([
      true,
      true,
      true,
      true,
    ])
    // The GFM header row's other cells are data here, though the document calls them headers.
    expect(rows[0]?.[1]).toContain('table-body-cell')
  })

  it('marks the footer’s rows', () => {
    expect(rowClasses(TABLE)).toEqual(['', '', '', ''])
    expect(rowClasses(`:::table{footer="1"}\n${TABLE}:::\n`)).toEqual([
      '',
      '',
      '',
      'table-footer-row',
    ])
    expect(rowClasses(`:::table{footer="2"}\n${TABLE}:::\n`).slice(2)).toEqual([
      'table-footer-row',
      'table-footer-row',
    ])
  })

  it('has nothing to say about a document without a table', () => {
    expect(presentationOf(harness.state('Prose.\n').doc)).toEqual([])
  })
})

/** What the plugin has decorated, as the same list `presentationOf` makes from scratch. */
function decorated(state: EditorState): { from: number; to: number; className: string }[] {
  return (tablePresentationKey.getState(state)?.find() ?? [])
    .map((each) => ({
      from: each.from,
      to: each.to,
      className: String(
        (each as unknown as { type: { attrs: { class: string } } }).type.attrs.class,
      ),
    }))
    .toSorted((a, b) => a.from - b.from)
}

function withPlugin(source: string): EditorState {
  const state = harness.state(source)
  return EditorState.create({ doc: state.doc, plugins: [createTablePresentationPlugin()] })
}

function fresh(state: EditorState) {
  return presentationOf(state.doc).toSorted((a, b) => a.from - b.from)
}

/** The position of the text `text`, to type at its start. */
function textAt(state: EditorState, text: string): number {
  let at = -1
  state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text === text) at = pos
  })
  return at
}

describe('keeping a table’s presentation as the document changes', () => {
  const source = (extra = '') => `Before.

:::table{footer="1"${extra}}
${TABLE}:::

After.
`

  it('starts as a fresh reading of the document', () => {
    const state = withPlugin(source())

    expect(decorated(state)).toEqual(fresh(state))
  })

  it('follows a change in a table: a column of numbers stops being one', () => {
    let state = withPlugin(source())
    state = state.apply(state.tr.insertText('n/a ', textAt(state, '12,400')))

    expect(decorated(state)).toEqual(fresh(state))
    expect(decorated(state).some((each) => each.className.includes('align-numeric'))).toBe(true)
  })

  it('follows a change to the wrapper’s options, which moves no position', () => {
    let state = withPlugin(source())
    const at = textAt(state, 'eu-west-1')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)))
    setTableAttribute('headers', 'both')(state, (tr) => {
      state = state.apply(tr)
    })

    expect(decorated(state)).toEqual(fresh(state))
    expect(decorated(state).some((each) => each.className.includes('table-row-header'))).toBe(true)
  })

  it('follows a table being wrapped, and a row being added', () => {
    let state = withPlugin(`${TABLE}
After.
`)
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, textAt(state, 'eu-west-1'))),
    )
    setTableAttribute('footer', '1')(state, (tr) => {
      state = state.apply(tr)
    })
    expect(decorated(state)).toEqual(fresh(state))

    const at = textAt(state, 'Total')
    state = state.apply(state.tr.insertText('Sub', at))
    expect(decorated(state)).toEqual(fresh(state))
  })

  it('moves along with a change before the table, and drops a table that is deleted', () => {
    let state = withPlugin(source())
    state = state.apply(state.tr.insertText('More. ', textAt(state, 'Before.')))
    expect(decorated(state)).toEqual(fresh(state))

    let start = -1
    let end = -1
    state.doc.forEach((node, offset) => {
      if (node.type.name === 'containerDirective') {
        start = offset
        end = offset + node.nodeSize
      }
    })
    state = state.apply(state.tr.delete(start, end))
    expect(decorated(state)).toEqual([])
  })

  it('leaves the decorations alone when nothing in the document changed', () => {
    const state = withPlugin(source())
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)))

    expect(tablePresentationKey.getState(next)).toBe(tablePresentationKey.getState(state))
  })
})

describe('a table whose rows are not all as long', () => {
  it('is drawn all the same, a cell that is not there counting as blank', () => {
    const { schema } = harness.state('Prose.')
    const cell = (text: string) =>
      nodeType(schema, 'tableCell').create(
        null,
        nodeType(schema, 'paragraph').create(null, schema.text(text)),
      )
    const row = (...texts: string[]) => nodeType(schema, 'tableRow').create(null, texts.map(cell))
    const table = nodeType(schema, 'table').create(null, [row('a', 'b'), row('1')])
    const doc = schema.topNodeType.create(null, table)

    expect(presentationOf(doc).map((each) => each.className)).toEqual([
      expect.stringContaining('table-column-header'),
      expect.stringContaining('table-column-header'),
      'align-numeric',
    ])
  })
})
