import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { documentToMdast } from '../document/ast.ts'
import { editorSchema } from './editor-schema.ts'
import { createTable, tableCommands } from './tables.ts'

const TABLE = ['| A | B |', '| - | - |', '| 1 | 2 |', ''].join('\n')

const harness = createEditorTestHarness()

/** Puts the caret in the first cell, which is where a table command acts from. */
function insideFirstCell(state: EditorState): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)))
}

function run(state: EditorState, command: (typeof tableCommands)['addRowAfter']): EditorState {
  let next = state
  command(state, (tr) => {
    next = state.apply(tr)
  })
  return next
}

function shape(state: EditorState): readonly number[] {
  const table = state.doc.firstChild
  if (table === null) throw new Error('There is no table in that document.')
  return table.children.map((row) => row.childCount)
}

describe('tables on the Markdown schema', () => {
  it('gives the four table nodes the roles prosemirror-tables looks for', () => {
    const roles = ['table', 'tableRow', 'tableCell', 'tableHeader'].map(
      (name) => editorSchema.nodes[name]?.spec['tableRole'],
    )
    expect(roles).toEqual(['table', 'row', 'cell', 'header_cell'])
  })

  it('gives cells the span attributes the library maintains', () => {
    const cell = editorSchema.nodes['tableCell']?.createAndFill()
    expect(cell?.attrs).toMatchObject({ colspan: 1, rowspan: 1, colwidth: null })
  })

  it('builds a new table with a header row and empty body rows', () => {
    const table = createTable(editorSchema, 2, 3)
    expect(table.childCount).toBe(3)
    expect(table.child(0).child(0).type.name).toBe('tableHeader')
    expect(table.child(1).child(0).type.name).toBe('tableCell')
    expect(table.child(0).childCount).toBe(3)
  })

  it('adds and removes rows and columns from the caret', () => {
    const start = insideFirstCell(harness.state(TABLE))
    expect(shape(start)).toEqual([2, 2])
    expect(shape(run(start, tableCommands.addRowAfter))).toEqual([2, 2, 2])
    expect(shape(run(start, tableCommands.addColumnAfter))).toEqual([3, 3])
    expect(shape(run(start, tableCommands.deleteColumn))).toEqual([1, 1])
    expect(run(start, tableCommands.deleteRow).doc.firstChild?.childCount).toBe(1)
  })

  it('moves between cells and deletes the table', () => {
    const start = insideFirstCell(harness.state(TABLE))
    expect(run(start, tableCommands.nextCell).selection.from).toBeGreaterThan(start.selection.from)
    expect(run(start, tableCommands.deleteTable).doc.firstChild?.type.name).not.toBe('table')
  })

  it('leaves a table it edited still serialisable as GFM', () => {
    const start = insideFirstCell(harness.state(TABLE))
    const grown = run(start, tableCommands.addRowAfter)
    expect(harness.read(documentToMdast(grown.doc).tree)).toContain('| A | B |')
  })
})
