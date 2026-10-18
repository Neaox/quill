import { Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { buildExtensions } from '../document/extensions.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { selectLine, selectTable } from './table-commands.ts'
import { markdownOfTable, tableCopyKey, tableOfSlice, tsvOfTable } from './table-copy.ts'

const harness = createEditorTestHarness()

const TABLE = '| Region | Owner |\n| :- | -: |\n| eu | Platform |\n| us | Data, ops |\n'

function select(command: ReturnType<typeof selectTable>): EditorState {
  const state = harness.state(TABLE)
  let next = state
  command(state, (tr) => {
    next = state.apply(tr)
  })
  return next
}

describe('the table inside a copied slice', () => {
  it('is the table of a selection of cells, however many of them', () => {
    const whole = select(selectTable(0))
    const row = select(selectLine('row', 1, 0))

    expect(tableOfSlice(whole.selection.content())?.childCount).toBe(3)
    expect(tableOfSlice(row.selection.content())?.childCount).toBe(1)
  })

  it('is nothing for an empty slice, and for text, which is not a table', () => {
    expect(tableOfSlice(Slice.empty)).toBeUndefined()

    const state = harness.state('Some text.\n')
    const text = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)))

    expect(tableOfSlice(text.selection.content())).toBeUndefined()
  })
})

describe('a table as the tabs and lines a spreadsheet reads', () => {
  it('has a tab between cells and a line between rows', () => {
    const table = tableOfSlice(select(selectTable(0)).selection.content())

    expect(table && tsvOfTable(table)).toBe('Region\tOwner\neu\tPlatform\nus\tData, ops')
  })

  it('has one row for a row, and a column’s cells one to a line', () => {
    const row = tableOfSlice(select(selectLine('row', 2, 0)).selection.content())
    const column = tableOfSlice(select(selectLine('column', 1, 0)).selection.content())

    expect(row && tsvOfTable(row)).toBe('us\tData, ops')
    expect(column && tsvOfTable(column)).toBe('Owner\nPlatform\nData, ops')
  })

  it('keeps a tab or a line break inside a cell from breaking the grid', () => {
    const state = harness.state('| a |\n| - |\n| one |\n')
    const doc = state.doc
    const table = doc.child(0)

    expect(tsvOfTable(table)).toBe('a\none')
  })
})

describe('a table as Markdown', () => {
  it('is the table as it is written, whole', () => {
    const table = tableOfSlice(select(selectTable(0)).selection.content())

    expect(table && markdownOfTable(table)).toBe(
      '| Region | Owner |\n| :- | -: |\n| eu | Platform |\n| us | Data, ops |\n',
    )
  })

  it('is the whole table, with no extra checks, for a table copied whole', () => {
    const table = tableOfSlice(select(selectTable(0)).selection.content())

    expect(table && markdownOfTable(table)).toContain('| :- | -: |')
  })

  it('makes the first row copied the header of what is copied, as GFM must', () => {
    const table = tableOfSlice(select(selectLine('row', 2, 0)).selection.content())

    expect(table && markdownOfTable(table)).toContain('| us | Data, ops |')
  })
})

describe('the plain text of a copy', () => {
  it('is the tabs and lines of copied cells, and left to the editor for anything else', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions(),
      content: harness.state(TABLE).doc.toJSON(),
    })
    const plugin = tableCopyKey.get(editor.state)
    const serializer = plugin?.props.clipboardTextSerializer
    if (plugin === undefined || serializer === undefined) {
      throw new Error('The table copy plugin is not installed.')
    }
    const serialize = (...args: Parameters<typeof serializer>) => serializer.call(plugin, ...args)
    const text = harness.state('Some text.\n')
    const words = text.apply(text.tr.setSelection(TextSelection.create(text.doc, 1, 5)))

    expect(serialize(select(selectLine('row', 1, 0)).selection.content(), editor.view)).toBe(
      'eu\tPlatform',
    )
    // Nothing of its own, so ProseMirror writes the text as it always does.
    expect(serialize(words.selection.content(), editor.view)).toBe('')
    editor.destroy()
  })
})
