import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { undo } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { TaskItemNodeView, toggleTask } from './task-item-view.ts'

const TASKS = '- [ ] Write the tests\n- [x] Ship *it*\n  - [ ] Nested\n'

function open(source = TASKS) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  return { ref, user: userEvent.setup(), ...result }
}

function markdown(ref: { current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

function editorOf(ref: { current: DocumentEditorHandle | null }) {
  const editor = ref.current?.editor
  if (editor === undefined || editor === null) throw new Error('There is no editor.')
  return editor
}

describe('a task in the editor', () => {
  it('is drawn with a real checkbox, named by its words and showing its state', () => {
    open()

    const first = screen.getByRole('checkbox', { name: 'Write the tests' })
    const second = screen.getByRole('checkbox', { name: 'Ship it' })
    expect(first).not.toBeChecked()
    expect(second).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Nested' })).not.toBeChecked()
    expect(first.closest('li')).toHaveAttribute('data-checked', 'false')
    expect(second.closest('li')).toHaveAttribute('data-checked', 'true')
  })

  it('is ticked by a click, written as [x], and untouched by undo only once', async () => {
    const { ref, user } = open()

    await user.click(screen.getByRole('checkbox', { name: 'Write the tests' }))

    expect(screen.getByRole('checkbox', { name: 'Write the tests' })).toBeChecked()
    expect(markdown(ref)).toBe('- [x] Write the tests\n- [x] Ship *it*\n  - [ ] Nested\n')

    act(() => {
      undo(editorOf(ref).state, editorOf(ref).view.dispatch)
    })
    expect(markdown(ref)).toBe(TASKS)
    expect(screen.getByRole('checkbox', { name: 'Write the tests' })).not.toBeChecked()
  })

  it('is toggled by Space on its checkbox, and written as [ ] when cleared', async () => {
    const { ref, user } = open()
    const box = screen.getByRole('checkbox', { name: 'Ship it' })
    box.focus()

    await user.keyboard(' ')

    expect(box).not.toBeChecked()
    expect(markdown(ref)).toBe('- [ ] Write the tests\n- [ ] Ship *it*\n  - [ ] Nested\n')
  })

  it('is toggled from its text by Mod-Enter, and nothing else is', () => {
    const { ref } = open()
    const editor = editorOf(ref)
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)))
      editor.commands.keyboardShortcut('Mod-Enter')
    })

    expect(markdown(ref)).toBe('- [x] Write the tests\n- [x] Ship *it*\n  - [ ] Nested\n')

    const { ref: plain } = open('Plain.\n')
    const prose = editorOf(plain)
    act(() => {
      prose.view.dispatch(prose.state.tr.setSelection(TextSelection.create(prose.state.doc, 2)))
    })
    expect(toggleTask(prose.state)).toBe(false)
  })

  it('renames its checkbox as its words change', () => {
    const { ref } = open()
    const editor = editorOf(ref)
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText('Now ', 3))
    })

    expect(screen.getByRole('checkbox', { name: 'Now Write the tests' })).toBeInTheDocument()
  })

  it('reads and writes every task list byte for byte', () => {
    for (const source of [TASKS, '* [X] Shouted\n', '1. [ ] Ordered\n', '- [ ]   spaced\n']) {
      const { ref, unmount } = open(source)
      expect(markdown(ref)).toBe(serializeDocument(parseDocument(source)))
      unmount()
    }
  })

  it('names an empty task, keeps to its own node, and owns only its checkbox', () => {
    const { ref } = open()
    const editor = editorOf(ref)
    const { schema } = editor
    const taskItem = schema.nodes['taskItem']
    const paragraph = schema.nodes['paragraph']
    if (taskItem === undefined || paragraph === undefined) throw new Error('no task schema')
    const empty = taskItem.create({ checked: false }, paragraph.create())
    const detached = new TaskItemNodeView(empty, editor.view, () => undefined)
    const box = detached.dom.querySelector('input')
    if (box === null) throw new Error('expected a checkbox')

    expect(box).toHaveAttribute('aria-label', 'Task')
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(markdown(ref)).toBe(TASKS)

    expect(detached.update(paragraph.create())).toBe(false)
    expect(detached.stopEvent(new Event('click'))).toBe(false)
    expect(detached.ignoreMutation({ target: box })).toBe(true)
    expect(detached.ignoreMutation({ target: detached.contentDOM })).toBe(false)
  })

  it('has no accessibility violations', async () => {
    const { container } = open()
    await expectNoAccessibilityViolations(container)
  })
})
