import { toast } from '@quill/ui'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { handleGridPaste, pasteGrid, UNMERGED_MESSAGE } from './table-paste.ts'
import { gridFromText } from './clipboard-grid.ts'

const harness = createEditorTestHarness()

const TABLE = ['| Region | Budget |', '| - | -: |', '| eu | 120 |', ''].join('\n')

afterEach(() => {
  vi.restoreAllMocks()
})

function markdown(state: EditorState): string {
  return harness.read(documentToMdast(state.doc).tree)
}

function inCell(source: string, text: string): EditorState {
  const state = harness.state(source)
  let at = -1
  state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text === text) at = pos
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)))
}

function clipboard(values: Readonly<Record<string, string>>) {
  return { getData: (type: string) => values[type] ?? '' }
}

function paste(
  state: EditorState,
  values: Readonly<Record<string, string>>,
): EditorState | undefined {
  let next: EditorState | undefined
  const handled = handleGridPaste(
    state,
    clipboard(values),
    (tr: Transaction) => {
      next = state.apply(tr)
    },
    document,
  )
  return handled ? next : undefined
}

describe('pasting a grid', () => {
  it('makes a new table from Excel, its first row the header, every merge unwound', () => {
    const info = vi.spyOn(toast, 'info').mockReturnValue('id')
    const state = paste(harness.state('Before.\n'), {
      'text/html':
        '<table><tr><td>Region</td><td>Budget</td></tr><tr><td colspan=2><b>eu</b>-west</td></tr></table>',
      'text/plain': 'Region\tBudget\neu-west\t',
    })

    expect(state && markdown(state)).toContain('| Region | Budget |\n| - | - |\n| **eu**-west | |')
    expect(info).toHaveBeenCalledWith(UNMERGED_MESSAGE)
  })

  it('reads tab-separated text when there is no HTML, and says nothing about merges', () => {
    const info = vi.spyOn(toast, 'info').mockReturnValue('id')
    const state = paste(harness.state('Before.\n'), { 'text/plain': 'A\tB\n1\t2' })

    expect(state && markdown(state)).toContain('| A | B |\n| - | - |\n| 1 | 2 |')
    expect(info).not.toHaveBeenCalled()
  })

  it('fills a table from the caret’s cell, growing it to fit, keeping its alignment', () => {
    const state = paste(inCell(TABLE, 'eu'), { 'text/plain': 'us\t90\tnew\nap\t300\tcol' })

    expect(state && markdown(state)).toBe(
      [
        '| Region | Budget | |',
        '| - | -: | - |',
        '| us | 90 | new |',
        '| ap | 300 | col |',
        '',
      ].join('\n'),
    )
  })

  it('keeps the cells beside and above the pasted block', () => {
    const state = paste(inCell(TABLE, '120'), { 'text/plain': 'x\ty' })

    expect(state && markdown(state)).toContain(
      '| Region | Budget | |\n| - | -: | - |\n| eu | x | y |',
    )
  })

  it('writes into the header row as header cells', () => {
    const state = paste(inCell(TABLE, 'Region'), { 'text/plain': 'Name\tCost' })

    expect(state && markdown(state)).toContain('| Name | Cost |\n| - | -: |\n| eu | 120 |')
    expect(state?.doc.firstChild?.firstChild?.firstChild?.type.name).toBe('tableHeader')
  })

  it('leaves one cell of text, prose and a cell selection to the ordinary paste', () => {
    expect(
      paste(inCell(TABLE, 'eu'), { 'text/html': '<table><tr><td>x</td></tr></table>' }),
    ).toBeUndefined()
    expect(paste(harness.state('Before.\n'), { 'text/plain': 'one\t' })).toBeUndefined()
    expect(
      paste(harness.state('Before.\n'), { 'text/html': '<p>Words.</p>', 'text/plain': 'a\tb' }),
    ).toBeUndefined()
    expect(paste(harness.state('Before.\n'), {})).toBeUndefined()
    expect(handleGridPaste(harness.state('Before.\n'), null, () => undefined, document)).toBe(false)
  })

  it('declines a grid into a table whose caret is in its caption', () => {
    const source = `:::table[Budgets]\n${TABLE}:::\n`
    const state = inCell(source, 'Budgets')
    const grid = gridFromText('a\tb\nc\td')
    if (grid === undefined) throw new Error('no grid')

    expect(pasteGrid(state, grid)).toBeUndefined()
  })
})
