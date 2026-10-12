import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { CellSelection, TableMap } from 'prosemirror-tables'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { describeTable } from './table-state.ts'

const harness = createEditorTestHarness()

const TABLE = '| a | b |\n| - | :-: |\n| 1 | 2 |\n| 3 | 4 |\n'

/** The state with the caret in the cell holding `text`. */
function inCell(source: string, text: string): EditorState {
  const state = harness.state(source)
  let at = -1
  state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text === text) at = pos
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)))
}

describe('what a table is set to', () => {
  it('is nothing outside a table', () => {
    expect(describeTable(harness.state('Prose.\n'))).toBeNull()
  })

  it('is the default for a plain table, with the alignment of the column the caret is in', () => {
    expect(describeTable(inCell(TABLE, 'a'))).toEqual({
      width: 'wide',
      headerRow: true,
      headerColumn: false,
      footer: false,
      caption: false,
      align: null,
      freezeHeader: false,
      freezeColumn: false,
      stack: false,
      sortable: true,
    })
    expect(describeTable(inCell(TABLE, 'b'))?.align).toBe('center')
  })

  it('reads the wrapper’s options as the Markdown holds them', () => {
    const source = `:::table{width="full" headers="both" footer="1" freeze="header,first-column" responsive="stack" sort="off"}\n${TABLE}:::\n`
    expect(describeTable(inCell(source, 'a'))).toMatchObject({
      width: 'full',
      headerRow: true,
      headerColumn: true,
      footer: true,
      freezeHeader: true,
      freezeColumn: true,
      stack: true,
      sortable: false,
    })
  })

  it('calls a width that is none of the three tracks custom', () => {
    expect(describeTable(inCell(`:::table{width="content"}\n${TABLE}:::\n`, 'a'))?.width).toBe(
      'content',
    )
    expect(describeTable(inCell(`:::table{width="85%"}\n${TABLE}:::\n`, 'a'))?.width).toBe('custom')
  })

  it('says the alignment is mixed across selected columns that differ', () => {
    const state = harness.state(TABLE)
    const start = 1
    const map = TableMap.get(state.doc.child(0))
    const cell = (column: number): number => start + (map.map[column] ?? 0)
    const spanning = state.apply(
      state.tr.setSelection(CellSelection.create(state.doc, cell(0), cell(1))),
    )

    expect(describeTable(spanning)?.align).toBe('mixed')
  })
})
