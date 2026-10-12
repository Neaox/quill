import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { CellSelection } from 'prosemirror-tables'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { actionState } from './editor-action.ts'
import type { ActionGroup, EditorAction } from './editor-action.ts'
import {
  COLUMN_REMOVAL,
  COLUMN_TOOLS,
  ROW_REMOVAL,
  ROW_TOOLS,
  TABLE_ALIGN_GROUP,
  TABLE_COLUMN_GROUP,
  TABLE_OPTION_GROUPS,
  TABLE_ROW_GROUP,
  TABLE_READING_GROUP,
  TABLE_REMOVAL,
  TABLE_STRUCTURE_GROUP,
  TABLE_WIDTH_GROUP,
} from './table-actions.ts'

const harness = createEditorTestHarness()

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n'

/** The state with the caret in the first cell, wherever the wrapper puts it. */
function inTable(source = TABLE): EditorState {
  const state = harness.state(source)
  let at = -1
  state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text === 'a') at = pos
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)))
}

function action(group: ActionGroup, id: string): EditorAction {
  const found = group.actions.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`The "${group.id}" group has no "${id}" action.`)
  return found
}

/** Runs an action and returns the Markdown the document becomes. */
function after(state: EditorState, chosen: EditorAction): string {
  let next = state
  chosen.command(state, (tr) => {
    next = state.apply(tr)
  })
  return harness.read(documentToMdast(next.doc).tree)
}

/** The width choices that are on in this state. */
const checked = (state: EditorState): EditorAction[] =>
  TABLE_WIDTH_GROUP.actions.filter((each) => actionState(each, state).checked)

describe('the width of a table', () => {
  it('is one of three, with the table’s own the one that is on', () => {
    expect(TABLE_WIDTH_GROUP.actions.map((each) => each.label)).toEqual(['Content', 'Wide', 'Full'])
    expect(checked(inTable()).map((each) => each.label)).toEqual(['Wide'])
    expect(
      checked(inTable(`:::table{width="full"}\n${TABLE}:::\n`)).map((each) => each.label),
    ).toEqual(['Full'])
  })

  it('writes the choice into the wrapper, and writes nothing for the default', () => {
    expect(after(inTable(), action(TABLE_WIDTH_GROUP, 'table-width-full'))).toContain(
      ':::table{width="full"}',
    )
    const full = inTable(`:::table{width="full"}\n${TABLE}:::\n`)
    expect(after(full, action(TABLE_WIDTH_GROUP, 'table-width-wide'))).not.toContain(':::table')
  })
})

describe('the structure of a table', () => {
  it('turns the header column and the footer row on and off', () => {
    const column = action(TABLE_STRUCTURE_GROUP, 'table-header-column')
    const footer = action(TABLE_STRUCTURE_GROUP, 'table-footer')
    expect(actionState(column, inTable()).checked).toBe(false)
    expect(after(inTable(), column)).toContain('headers="both"')
    expect(after(inTable(), footer)).toContain('footer="1"')
  })

  it('refuses to take away the only header, and says the row is on', () => {
    const row = action(TABLE_STRUCTURE_GROUP, 'table-header-row')
    expect(actionState(row, inTable()).checked).toBe(true)
    expect(row.command(inTable())).toBe(false)
  })

  it('adds a caption, which the caption check then shows', () => {
    const caption = action(TABLE_STRUCTURE_GROUP, 'table-caption')
    expect(actionState(caption, inTable()).checked).toBe(false)
    expect(after(inTable(), caption)).toContain('Caption')
  })

  it('is on for none of its choices outside a table', () => {
    const outside = harness.state('Prose.\n')
    for (const each of [...TABLE_OPTION_GROUPS, TABLE_ALIGN_GROUP].flatMap(
      (group) => group.actions,
    )) {
      expect(actionState(each, outside)).toEqual({ enabled: false, checked: false })
    }
  })
})

describe('what a table says to its readers', () => {
  it('keeps the header and the first column in view, together or one at a time', () => {
    const header = action(TABLE_READING_GROUP, 'table-freeze-header')
    const column = action(TABLE_READING_GROUP, 'table-freeze-column')
    expect(after(inTable(), header)).toContain('freeze="header"')
    expect(after(inTable(), column)).toContain('freeze="first-column"')
    const both = inTable(`:::table{freeze="header,first-column"}\n${TABLE}:::\n`)
    expect(actionState(header, both).checked).toBe(true)
    expect(actionState(column, both).checked).toBe(true)
    expect(after(both, header)).toContain('freeze="first-column"')
    expect(after(both, column)).toContain('freeze="header"')
  })

  it('puts the header back out of view when it was the only thing kept', () => {
    const header = action(TABLE_READING_GROUP, 'table-freeze-header')
    const frozen = inTable(`:::table{freeze="header"}\n${TABLE}:::\n`)

    expect(after(frozen, header)).not.toContain(':::table')
  })

  it('turns cards on phones on and off', () => {
    const stack = action(TABLE_READING_GROUP, 'table-stack')
    expect(after(inTable(), stack)).toContain('responsive="stack"')
    const on = inTable(`:::table{responsive="stack"}\n${TABLE}:::\n`)
    expect(actionState(stack, on).checked).toBe(true)
    expect(after(on, stack)).not.toContain(':::table')
  })

  it('lets readers sort unless it is turned off', () => {
    const sort = action(TABLE_READING_GROUP, 'table-sortable')
    expect(actionState(sort, inTable()).checked).toBe(true)
    expect(after(inTable(), sort)).toContain('sort="off"')
    const off = inTable(`:::table{sort="off"}\n${TABLE}:::\n`)
    expect(actionState(sort, off).checked).toBe(false)
    expect(after(off, sort)).not.toContain(':::table')
  })
})

describe('picking out a row or a column', () => {
  it('selects the whole of the one the caret is in', () => {
    const select = (group: ActionGroup, id: string): EditorState => {
      const state = inTable()
      let next = state
      action(group, id).command(state, (tr) => {
        next = state.apply(tr)
      })
      return next
    }

    const row = select(TABLE_ROW_GROUP, 'row-select').selection
    const column = select(TABLE_COLUMN_GROUP, 'column-select').selection
    expect(row instanceof CellSelection && row.isRowSelection()).toBe(true)
    expect(column instanceof CellSelection && column.isColSelection()).toBe(true)
  })
})

describe('what the table toolbar keeps to hand', () => {
  it('has a row’s tools, a column’s tools, and a way to remove each and the table', () => {
    expect(ROW_TOOLS.map((each) => each.id)).toEqual([
      'row-above',
      'row-below',
      'row-up',
      'row-down',
    ])
    expect(COLUMN_TOOLS.map((each) => each.id)).toEqual([
      'column-left',
      'column-right',
      'column-move-left',
      'column-move-right',
    ])
    for (const removal of [ROW_REMOVAL, COLUMN_REMOVAL, TABLE_REMOVAL]) {
      expect(removal).toHaveLength(1)
      expect(removal[0]?.destructive).toBe(true)
    }
  })
})
