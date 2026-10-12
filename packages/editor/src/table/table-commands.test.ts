import { CellSelection } from 'prosemirror-tables'
import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'
import { undo, history } from '@tiptap/pm/history'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import {
  addColumn,
  addRow,
  alignOf,
  deleteColumns,
  deleteRows,
  enterInTable,
  goToCell,
  insertLine,
  moveColumn,
  moveRow,
  nextCellOrNewRow,
  selectLine,
  selectTable,
  setColumnAlign,
  setHeaders,
  setTableAttribute,
  toggleCaption,
  toggleFooter,
} from './table-commands.ts'
import { tableContext } from './table-context.ts'

const harness = createEditorTestHarness()

const TABLE = [
  '| Region | Owner | Budget |',
  '| - | - | - |',
  '| eu | Platform | 120 |',
  '| us | Data | 90 |',
  '',
].join('\n')

/** The Markdown a state writes. */
function markdown(state: EditorState): string {
  return harness.read(documentToMdast(state.doc).tree)
}

/** A state with the caret in the cell holding `text`. */
function inCell(source: string, text: string, offset = 0): EditorState {
  const state = harness.state(source)
  let at = -1
  state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text === text) at = pos
  })
  if (at === -1) throw new Error(`no cell ${text}`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at + offset)))
}

function run(state: EditorState, command: Command): EditorState {
  let next: EditorState | undefined
  const ran = command(state, (tr) => {
    next = state.apply(tr)
  })
  if (!ran || next === undefined) throw new Error('The command declined to run.')
  return next
}

function declines(state: EditorState, command: Command): boolean {
  return !command(state) && !command(state, () => undefined)
}

/** The text of the cell the caret is in. */
function caretCell(state: EditorState): string {
  return state.selection.$from.parent.textContent
}

describe('rows and columns', () => {
  it('adds a column after the selection, unaligned, keeping the others', () => {
    const state = run(
      inCell(TABLE.replace('| - | - | - |', '| :- | - | -: |'), 'Owner'),
      addColumn('after'),
    )

    expect(markdown(state)).toContain('| Region | Owner | | Budget |')
    expect(alignOf(state.doc.child(0))).toEqual(['left', null, null, 'right'])
  })

  it('adds a column before, sharing out the proportions', () => {
    const source = `:::table{columns="1fr 2fr 3fr"}\n${TABLE}:::\n`
    const state = run(inCell(source, 'Region'), addColumn('before'))

    expect(markdown(state)).toContain(':::table{columns="2fr 1fr 2fr 3fr"}')
    expect(markdown(state)).toContain('| | Region | Owner | Budget |')
  })

  it('adds a row below, and never one above the header row', () => {
    expect(markdown(run(inCell(TABLE, 'eu'), addRow('after')))).toContain(
      '| eu | Platform | 120 |\n| | | |\n| us |',
    )
    expect(markdown(run(inCell(TABLE, 'us'), addRow('before')))).toContain(
      '| eu | Platform | 120 |\n| | | |\n| us |',
    )
    expect(declines(inCell(TABLE, 'Region'), addRow('before'))).toBe(true)
  })

  it('adds a row above the first row when the rows are the only headers, keeping it a GFM header', () => {
    const source = `:::table{headers=row}\n${TABLE}:::\n`
    const state = run(inCell(source, 'Region'), addRow('before'))

    expect(markdown(state)).toContain('| | | |\n| - | - | - |\n| Region | Owner | Budget |')
    const first = state.doc.firstChild?.lastChild?.firstChild
    expect(first?.firstChild?.type.name).toBe('tableHeader')
  })

  it('deletes columns with their alignment and share, never the last one', () => {
    const source = `:::table{columns="1fr 2fr 3fr"}\n${TABLE.replace('| - | - | - |', '| :- | :-: | -: |')}:::\n`
    const state = run(inCell(source, 'Owner'), deleteColumns)

    expect(markdown(state)).toContain(':::table{columns="1fr 3fr"}')
    expect(markdown(state)).toContain('| Region | Budget |\n| :- | -: |')
    expect(declines(inCell('| A |\n| - |\n| 1 |\n', 'A'), deleteColumns)).toBe(true)
  })

  it('deletes body rows, never the header row or the last body row', () => {
    expect(markdown(run(inCell(TABLE, 'eu'), deleteRows))).not.toContain('| eu |')
    expect(declines(inCell(TABLE, 'Region'), deleteRows)).toBe(true)
    expect(declines(inCell('| A |\n| - |\n| 1 |\n', '1'), deleteRows)).toBe(true)
  })

  it('moves a body row, and keeps the header row first', () => {
    const state = run(inCell(TABLE, 'eu'), moveRow(1, 2))

    expect(markdown(state)).toContain('| us | Data | 90 |\n| eu | Platform | 120 |')
    expect(declines(inCell(TABLE, 'eu'), moveRow(1, 0))).toBe(true)
    expect(declines(inCell(TABLE, 'eu'), moveRow(1, 1))).toBe(true)
    expect(declines(inCell(TABLE, 'eu'), moveRow(1, 9))).toBe(true)
  })

  it('moves the first row too when the rows are the only headers', () => {
    const source = `:::table{headers=row}\n${TABLE}:::\n`
    const state = run(inCell(source, 'eu'), moveRow(1, 0))

    expect(markdown(state)).toContain('| eu | Platform | 120 |\n| - | - | - |\n| Region |')
  })

  it('moves a column with its alignment and its share', () => {
    const source = `:::table{columns="1fr 2fr 3fr"}\n${TABLE.replace('| - | - | - |', '| :- | - | -: |')}:::\n`
    const state = run(inCell(source, 'Region'), moveColumn(0, 2))

    expect(markdown(state)).toContain(':::table{columns="2fr 3fr 1fr"}')
    expect(markdown(state)).toContain('| Owner | Budget | Region |\n| - | -: | :- |')
    expect(declines(inCell(source, 'Region'), moveColumn(0, 3))).toBe(true)
    expect(declines(inCell(source, 'Region'), moveColumn(1, 1))).toBe(true)
  })

  it('moves a table it is given by position, wherever the selection is', () => {
    const state = harness.state(TABLE)

    expect(markdown(run(state, moveColumn(0, 1, 0)))).toContain('| Owner | Region | Budget |')
    expect(markdown(run(state, moveRow(2, 1, 0)))).toContain('| us | Data | 90 |\n| eu |')
    expect(declines(state, moveRow(2, 1, 1))).toBe(true)
  })

  it('inserts a line where a border is, with the caret in its first cell', () => {
    const state = harness.state(TABLE)

    const row = run(state, insertLine('row', 2, 0))
    expect(markdown(row)).toContain('| eu | Platform | 120 |\n| | | |\n| us |')
    expect(row.selection).toBeInstanceOf(TextSelection)
    expect(tableContext(row)?.rect).toMatchObject({ top: 2, left: 0 })

    const first = run(state, insertLine('column', 0, 0))
    expect(markdown(first)).toContain('| | Region | Owner | Budget |')
    expect(tableContext(first)?.rect).toMatchObject({ top: 0, left: 0 })
    const last = run(state, insertLine('column', 3, 0))
    expect(markdown(last)).toContain('| Region | Owner | Budget | |')
    expect(tableContext(last)?.rect).toMatchObject({ top: 0, left: 3 })
  })

  it('inserts nothing above the header row, outside the table, or off its ends', () => {
    const state = harness.state(TABLE)

    expect(declines(state, insertLine('row', 0, 0))).toBe(true)
    expect(declines(state, insertLine('row', 4, 0))).toBe(true)
    expect(declines(state, insertLine('column', -1, 0))).toBe(true)
    expect(declines(state, insertLine('row', 1, 1))).toBe(true)
  })

  it('inserts above the first row when the rows are the only headers', () => {
    const state = harness.state(`:::table{headers=row}\n${TABLE}:::\n`)

    expect(markdown(run(state, insertLine('row', 0, 1)))).toContain('| | | |\n| - | - | - |')
  })

  it('selects a whole row or column', () => {
    const state = harness.state(TABLE)
    const column = run(state, selectLine('column', 1, 0)).selection

    expect(column).toBeInstanceOf(CellSelection)
    expect(column instanceof CellSelection && column.isColSelection()).toBe(true)
    const row = run(state, selectLine('row', 2, 0)).selection
    expect(row instanceof CellSelection && row.isRowSelection()).toBe(true)
    expect(declines(state, selectLine('row', 3, 0))).toBe(true)
    expect(declines(state, selectLine('row', 0, 1))).toBe(true)
  })

  it('selects every cell of a table, as its corner does', () => {
    const state = harness.state(TABLE)
    const all = run(state, selectTable(0)).selection

    expect(all).toBeInstanceOf(CellSelection)
    expect(all instanceof CellSelection && all.isRowSelection() && all.isColSelection()).toBe(true)
    expect(tableContext(run(state, selectTable(0)))?.rect).toMatchObject({
      top: 0,
      left: 0,
      bottom: 3,
      right: 3,
    })
    expect(declines(state, selectTable(1))).toBe(true)
    expect(declines(harness.state('Prose.'), selectTable(0))).toBe(true)
  })

  it('aligns the selected columns, and declines what is already so', () => {
    const state = run(inCell(TABLE, 'Budget'), setColumnAlign('right'))

    expect(markdown(state)).toContain('| - | - | -: |')
    expect(declines(state, setColumnAlign('right'))).toBe(true)
    expect(markdown(run(state, setColumnAlign(null)))).toContain('| - | - | - |')
  })

  it('declines everything outside a table', () => {
    const outside = harness.state('Prose.\n')
    for (const command of [
      addColumn('after'),
      addRow('after'),
      deleteColumns,
      deleteRows,
      moveRow(1, 2),
      moveColumn(0, 1),
      setColumnAlign('left'),
      setTableAttribute('width', 'full'),
      toggleFooter,
      toggleCaption,
      nextCellOrNewRow,
      enterInTable,
    ]) {
      expect(declines(outside, command)).toBe(true)
    }
  })
})

describe('the wrapper', () => {
  it('wraps a bare table when an option is chosen, and unwraps it when none is left', () => {
    const wide = run(inCell(TABLE, 'eu'), setTableAttribute('width', 'full'))
    expect(markdown(wide)).toBe(`:::table{width="full"}\n${TABLE}:::\n`)
    expect(caretCell(wide)).toBe('eu')

    const plain = run(wide, setTableAttribute('width', undefined))
    expect(markdown(plain)).toBe(TABLE)
    expect(declines(plain, setTableAttribute('width', undefined))).toBe(true)
  })

  it('keeps attributes it does not know', () => {
    const source = `:::table{future="x"}\n${TABLE}:::\n`

    expect(markdown(run(inCell(source, 'eu'), setTableAttribute('sort', 'off')))).toContain(
      ':::table{future="x" sort="off"}',
    )
  })

  it('sets the headers, and refuses a table with none', () => {
    const both = run(inCell(TABLE, 'eu'), setHeaders({ row: true, column: true }))
    expect(markdown(both)).toContain(':::table{headers="both"}')
    expect(markdown(run(both, setHeaders({ row: false, column: true })))).toContain(
      ':::table{headers="row"}',
    )
    expect(markdown(run(both, setHeaders({ row: true, column: false })))).toBe(TABLE)
    expect(declines(both, setHeaders({ row: false, column: false }))).toBe(true)
  })

  it('turns the footer on and off, and declines a table too short for one', () => {
    const on = run(inCell(TABLE, 'eu'), toggleFooter)
    expect(markdown(on)).toContain(':::table{footer="1"}')
    expect(markdown(run(on, toggleFooter))).toBe(TABLE)
    expect(declines(inCell('| A |\n| - |\n| 1 |\n', '1'), toggleFooter)).toBe(true)
  })

  it('adds a caption with its prompt selected, and takes it away again', () => {
    const captioned = run(inCell(TABLE, 'eu'), toggleCaption)
    expect(markdown(captioned)).toBe(`:::table[Caption]\n${TABLE}:::\n`)
    const { from, to } = captioned.selection
    expect(captioned.doc.textBetween(from, to)).toBe('Caption')
    expect(toggleCaption(captioned)).toBe(true)

    const inTable = captioned.apply(
      captioned.tr.setSelection(TextSelection.near(captioned.doc.resolve(from + 12))),
    )
    expect(tableContext(inTable)).toBeDefined()
    expect(markdown(run(inTable, toggleCaption))).toBe(TABLE)
  })

  it('keeps the wrapper while a caption is left after the last option goes', () => {
    const source = `:::table[Budgets]{width=full}\n${TABLE}:::\n`

    expect(markdown(run(inCell(source, 'eu'), setTableAttribute('width', undefined)))).toBe(
      `:::table[Budgets]\n${TABLE}:::\n`,
    )
  })
})

describe('moving between cells at once', () => {
  it.each([
    ['up', 'Data', 'Platform'],
    ['down', 'Owner', 'Platform'],
    ['left', 'Data', 'us'],
    ['right', 'Data', '90'],
  ] as const)('goes %s from %s to %s, whatever the caret was beside', (direction, from, to) => {
    expect(caretCell(run(inCell(TABLE, from, 2), goToCell(direction)))).toBe(to)
  })

  it('puts the caret at the start of the cell it arrives in', () => {
    const arrived = run(inCell(TABLE, 'Platform', 5), goToCell('left'))

    expect(arrived.selection.$from.parentOffset).toBe(0)
  })

  it.each([
    ['up', 'Region'],
    ['left', 'Region'],
    ['down', '90'],
    ['right', '90'],
  ] as const)(
    'stays where it is at the %s edge, and keeps the key from doing anything else',
    (direction, text) => {
      const at = inCell(TABLE, text, 1)
      const dispatched: unknown[] = []

      const spent = goToCell(direction)(at, (tr) => dispatched.push(tr))

      expect(spent).toBe(true)
      expect(dispatched).toEqual([])
    },
  )
})

describe('the keyboard', () => {
  it('moves to the next cell with Tab, and adds a row from the last cell', () => {
    expect(caretCell(run(inCell(TABLE, 'eu'), nextCellOrNewRow))).toBe('Platform')
    const added = run(inCell(TABLE, '90', 2), nextCellOrNewRow)

    expect(markdown(added)).toContain('| us | Data | 90 |\n| | | |')
    expect(added.selection.$from.parent.textContent).toBe('')
    expect(tableContext(added)?.rect.top).toBe(3)
    expect(tableContext(added)?.rect.left).toBe(0)
  })

  it('goes down a cell with Enter, and adds a row from the last row', () => {
    const down = run(inCell(TABLE, 'Platform'), enterInTable)
    expect(caretCell(down)).toBe('Data')

    const below = run(inCell(TABLE, 'Data'), enterInTable)
    expect(markdown(below)).toContain('| us | Data | 90 |\n| | | |')
    expect(tableContext(below)?.rect.left).toBe(1)

    const fromLast = run(inCell(TABLE, '90', 2), enterInTable)
    expect(tableContext(fromLast)?.rect.left).toBe(0)
    expect(tableContext(fromLast)?.rect.top).toBe(3)
  })

  it('undoes every change in one step', () => {
    const base = inCell(TABLE, '90', 2)
    const state = base.apply(base.tr)
    const withHistory = harness.state(TABLE).reconfigure({ plugins: [history()] })
    const caret = withHistory.apply(
      withHistory.tr.setSelection(state.selection.map(withHistory.doc, state.tr.mapping)),
    )
    const added = run(caret, nextCellOrNewRow)
    const undone = run(added, undo)

    expect(markdown(undone)).toBe(TABLE)
  })
})
