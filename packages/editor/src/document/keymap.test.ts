import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { editorSchema } from '../schema/editor-schema.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { documentToMdast } from './ast.ts'
import { keyboardShortcuts } from './keymap.ts'

const harness = createEditorTestHarness()
const shortcuts = keyboardShortcuts(editorSchema)

function binding(key: string): Command {
  const command = shortcuts[key]
  if (command === undefined) throw new Error(`Nothing is bound to ${key}.`)
  return command
}

function press(markdown: string, key: string, from: number, to = from): string | null {
  const opened = harness.state(markdown)
  const state = opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, from, to)))
  let next: EditorState | null = null
  const ran = binding(key)(state, (tr) => {
    next = state.apply(tr)
  })
  return ran && next !== null ? harness.read(documentToMdast((next as EditorState).doc).tree) : null
}

describe('the editor keyboard map', () => {
  it('binds the marks a writer reaches for', () => {
    expect(press('bold me\n', 'Mod-b', 1, 8)).toBe('**bold me**\n')
    expect(press('italic\n', 'Mod-i', 1, 7)).toBe('*italic*\n')
    expect(press('struck\n', 'Mod-Shift-x', 1, 7)).toBe('~~struck~~\n')
    expect(press('code\n', 'Mod-e', 1, 5)).toBe('`code`\n')
  })

  it('binds all six heading levels, and the way back to a paragraph', () => {
    expect(press('A title\n', 'Mod-Alt-1', 1)).toBe('# A title\n')
    expect(press('A title\n', 'Mod-Alt-6', 1)).toBe('###### A title\n')
    expect(press('## A title\n', 'Mod-Alt-0', 1)).toBe('A title\n')
  })

  it('binds the three kinds of list', () => {
    expect(press('An item\n', 'Mod-Shift-8', 1)).toBe('- An item\n')
    expect(press('An item\n', 'Mod-Shift-7', 1)).toBe('1. An item\n')
    expect(press('An item\n', 'Mod-Shift-9', 1)).toContain('[ ] An item')
  })

  it('switches a list off with its own key, and one kind of list to another', () => {
    expect(press('- An item\n', 'Mod-Shift-8', 3)).toBe('An item\n')
    expect(press('1. An item\n', 'Mod-Shift-7', 4)).toBe('An item\n')
    expect(press('- An item\n', 'Mod-Shift-7', 3)).toBe('1. An item\n')
  })

  it('binds a code block, and a hard break', () => {
    expect(press('some code\n', 'Mod-Alt-c', 1)).toBe('```\nsome code\n```\n')
    expect(press('one two\n', 'Shift-Enter', 4)).toContain('\\\n')
  })

  it('splits a list item on Enter, in both kinds of list', () => {
    expect(press('- one\n', 'Enter', 4)).toBe('- o\n- ne\n')
    expect(press('- [x] one\n', 'Enter', 4)).toContain('- [x] o')
  })

  it('moves a table’s column with Alt+Left and Alt+Right, and spends them outside one', () => {
    const NL = String.fromCharCode(10)
    const table = '| a | b |' + NL + '| - | - |' + NL + '| c | d |' + NL
    expect(press(table, 'Alt-ArrowRight', 4)).toContain('| b | a |')
    expect(press('A paragraph.' + NL, 'Alt-ArrowLeft', 3)).toBeNull()
  })

  it('moves a table’s row with Alt+Up and Alt+Down, and the block or list item outside one', () => {
    const NL = String.fromCharCode(10)
    const table = '| a | b |' + NL + '| - | - |' + NL + '| c | d |' + NL + '| e | f |' + NL
    // Position 28 is in the "e" cell of the last row, 16 in the "c" cell above it.
    expect(press(table, 'Alt-ArrowUp', 28)).toContain('| e | f |' + NL + '| c | d |')
    // Up from the first row under the header has nowhere to go, and the table stays where it is.
    expect(press(table, 'Alt-ArrowUp', 16)).toBeNull()
    expect(press('One.' + NL + NL + 'Two.' + NL, 'Alt-ArrowUp', 8)).toBe(
      'Two.' + NL + NL + 'One.' + NL,
    )
    expect(press('- one' + NL + '- two' + NL, 'Alt-ArrowDown', 3)).toBe('- two' + NL + '- one' + NL)
  })

  it('goes to the neighbouring cell with Alt+Shift and an arrow', () => {
    const NL = String.fromCharCode(10)
    const table = '| a | b |' + NL + '| - | - |' + NL + '| c | d |' + NL
    expect(press(table, 'Alt-Shift-ArrowRight', 4)).toBe(table)
    expect(press('A paragraph.' + NL, 'Alt-Shift-ArrowRight', 3)).toBeNull()
  })

  it('selects outwards with Mod-a, rather than the whole document at once', () => {
    const opened = harness.state('One.\n\nTwo words.\n')
    const state = opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, 9)))
    let next: EditorState = state
    binding('Mod-a')(state, (tr) => {
      next = state.apply(tr)
    })

    expect(next.doc.textBetween(next.selection.from, next.selection.to)).toBe('Two words.')
  })

  it('leaves Enter to the document outside a list', () => {
    expect(press('A paragraph.\n', 'Enter', 3)).toBeNull()
  })

  it('indents and outdents a list item with Tab', () => {
    const nested = press('- one\n- two\n', 'Tab', 10)
    expect(nested).toBe('- one\n  - two\n')
    expect(press('- one\n  - two\n', 'Shift-Tab', 12)).toBe('- one\n- two\n')
  })

  it('moves between table cells with Tab', () => {
    const table = ['| A | B |', '| - | - |', '| 1 | 2 |', ''].join('\n')
    expect(press(table, 'Tab', 4)).toBe(table)
  })

  it('adds a row when Tab leaves the last cell, so a table can be written from the keyboard', () => {
    const table = ['| A | B |', '| - | - |', '| 1 | 2 |', ''].join('\n')
    // Position 21 is inside the last cell of the last row.
    expect(press(table, 'Tab', 21)).toContain('| | |')
  })

  it('moves down a table with Enter instead of splitting a cell, which GFM cannot hold', () => {
    const table = ['| A | B |', '| - | - |', '| 1 | 2 |', ''].join('\n')
    expect(press(table, 'Enter', 4)).toBe(table)
    expect(press(table, 'Enter', 21)).toContain('| | |')
  })

  it('leaves Tab alone where it means neither of those things', () => {
    expect(press('A paragraph.\n', 'Tab', 3)).toBeNull()
    expect(press('A paragraph.\n', 'Shift-Tab', 3)).toBeNull()
  })

  it('binds undo and redo, which need a history to act on', () => {
    expect(press('A paragraph.\n', 'Mod-z', 1)).toBeNull()
    expect(press('A paragraph.\n', 'Mod-y', 1)).toBeNull()
    expect(press('A paragraph.\n', 'Mod-Shift-z', 1)).toBeNull()
  })

  it('binds select next occurrence to Ctrl+D, which selects the word at the caret first', () => {
    const opened = harness.state('ship the ship\n')
    const state = opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, 2)))
    let next: EditorState | undefined
    binding('Mod-d')(state, (tr) => {
      next = state.apply(tr)
    })
    expect(next?.doc.textBetween(next.selection.from, next.selection.to)).toBe('ship')
    expect(next?.selection.from).toBe(1)
  })
})
