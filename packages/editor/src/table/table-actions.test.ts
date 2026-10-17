import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { describeTable, tableAction } from './table-actions.ts'

const harness = createEditorTestHarness()

const ROWS = [
  '| Region | Owner | Budget |',
  '| - | - | - |',
  '| eu | Platform | 120 |',
  '| us | Data | 90 |',
].join('\n')

function wrapped(attributes: string, rows = ROWS): string {
  return `:::table{${attributes}}\n${rows}\n:::\n`
}

/** A state with the caret in the cell holding `text`. */
function inCell(source: string, text: string): EditorState {
  const state = harness.state(source)
  let at = -1
  state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text === text) at = pos
  })
  if (at === -1) throw new Error(`no cell ${text}`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)))
}

function run(state: EditorState, id: string): EditorState {
  let next = state
  const ran = tableAction(state, id)?.command(state, (tr) => {
    next = state.apply(tr)
  })
  if (ran !== true) throw new Error(`${id} declined to run`)
  return next
}

function markdown(state: EditorState): string {
  return harness.read(documentToMdast(state.doc).tree)
}

function unavailable(state: EditorState, id: string): string | undefined {
  return tableAction(state, id)?.unavailable
}

describe('a table as the actions see it', () => {
  it('reads its width: wide unless said otherwise, and custom for a share of the page', () => {
    expect(describeTable(inCell(wrapped('width=wide'), 'eu'))?.width).toBe('wide')
    expect(describeTable(inCell(wrapped('width=content'), 'eu'))?.width).toBe('content')
    expect(describeTable(inCell(wrapped('width="60%"'), 'eu'))?.width).toBe('custom')
  })

  it('reads what is frozen, and a mixed alignment across the selection', () => {
    const state = inCell(wrapped('freeze="header,first-column"'), 'eu')
    const table = describeTable(state)

    expect(table?.freezeHeader).toBe(true)
    expect(table?.freezeColumn).toBe(true)
  })
})

describe('the reading settings', () => {
  it('turns freezing on and off one part at a time', () => {
    const header = run(inCell(ROWS, 'eu'), 'freeze-header')
    expect(markdown(header)).toContain('freeze="header"')
    const both = run(header, 'freeze-column')
    expect(markdown(both)).toContain('freeze="header,first-column"')
    const column = run(both, 'freeze-header')
    expect(markdown(column)).toContain('freeze="first-column"')
    expect(markdown(run(column, 'freeze-column'))).not.toContain(':::table')
  })

  it('turns cards on phones and sorting on and off', () => {
    const stacked = run(inCell(ROWS, 'eu'), 'stack')
    expect(markdown(stacked)).toContain('responsive="stack"')
    expect(markdown(run(stacked, 'stack'))).not.toContain('responsive')

    const fixed = run(inCell(ROWS, 'eu'), 'sort')
    expect(markdown(fixed)).toContain('sort="off"')
    expect(markdown(run(fixed, 'sort'))).not.toContain('sort=')
  })
})

describe('what cannot be done, and why', () => {
  it('keeps the first row, and one row under it', () => {
    expect(unavailable(inCell(ROWS, 'Region'), 'delete-row')).toBe(
      'The header row cannot be deleted',
    )
    expect(unavailable(inCell(wrapped('headers=row'), 'Region'), 'delete-row')).toBe(
      'The first row cannot be deleted',
    )
    const short = ROWS.split('\n').slice(0, 3).join('\n')
    expect(unavailable(inCell(short, 'eu'), 'delete-row')).toBe(
      'A table keeps at least one row under the first',
    )
    expect(unavailable(inCell(ROWS, 'eu'), 'delete-row')).toBeUndefined()
  })

  it('needs a body row before a footer', () => {
    const short = ROWS.split('\n').slice(0, 3).join('\n')
    expect(unavailable(inCell(short, 'eu'), 'footer-row')).toBe(
      'Add a row first: the header row cannot be the footer',
    )
    expect(unavailable(inCell(ROWS, 'eu'), 'footer-row')).toBeUndefined()
  })

  it('says where a row or column cannot move', () => {
    expect(unavailable(inCell(wrapped('headers=row'), 'Region'), 'move-row-up')).toBe(
      'Already the first row',
    )
    expect(unavailable(inCell(ROWS, 'eu'), 'move-row-up')).toBe('The header row stays first')
    expect(unavailable(inCell(ROWS, 'us'), 'move-row-up')).toBeUndefined()
    expect(unavailable(inCell(ROWS, 'Region'), 'move-row-down')).toBe('The header row stays first')
    expect(unavailable(inCell(ROWS, 'us'), 'move-row-down')).toBe('Already the last row')
    expect(unavailable(inCell(ROWS, 'eu'), 'move-row-down')).toBeUndefined()
    expect(unavailable(inCell(ROWS, 'eu'), 'move-column-left')).toBe('Already the first column')
    expect(unavailable(inCell(ROWS, '120'), 'move-column-right')).toBe('Already the last column')
  })

  it('refuses to run an action that cannot be done', () => {
    const state = inCell(ROWS, 'Region')
    expect(tableAction(state, 'delete-row')?.command(state, () => undefined)).toBe(false)
  })
})
