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

  it('binds a code block, and a hard break', () => {
    expect(press('some code\n', 'Mod-Alt-c', 1)).toBe('```\nsome code\n```\n')
    expect(press('one two\n', 'Shift-Enter', 4)).toContain('\\\n')
  })

  it('splits a list item on Enter, in both kinds of list', () => {
    expect(press('- one\n', 'Enter', 4)).toBe('- o\n- ne\n')
    expect(press('- [x] one\n', 'Enter', 4)).toContain('- [x] o')
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

  it('leaves Tab alone where it means neither of those things', () => {
    expect(press('A paragraph.\n', 'Tab', 3)).toBeNull()
    expect(press('A paragraph.\n', 'Shift-Tab', 3)).toBeNull()
  })

  it('binds undo and redo, which need a history to act on', () => {
    expect(press('A paragraph.\n', 'Mod-z', 1)).toBeNull()
    expect(press('A paragraph.\n', 'Mod-y', 1)).toBeNull()
    expect(press('A paragraph.\n', 'Mod-Shift-z', 1)).toBeNull()
  })
})
