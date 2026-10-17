import { EditorView as CodeMirrorView } from '@codemirror/view'
import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { undo } from '@tiptap/pm/history'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import type { SlashRecents } from '../slash/slash-recents.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { LanguagePicker } from './language-picker.tsx'
import { paintedRanges } from './token-painting.ts'

function memoryRecents(initial: readonly string[] = []): SlashRecents {
  let ids = [...initial]
  return {
    read: () => ids,
    remember: (id) => {
      ids = [id, ...ids.filter((known) => known !== id)]
    },
  }
}

function picker(language: string | null = 'ts', recent = memoryRecents()) {
  const onChoose = vi.fn<(name: string | null) => boolean>(() => true)
  const onDismiss = vi.fn<() => void>()
  const result = render(
    <LanguagePicker
      language={language}
      onChoose={onChoose}
      onDismiss={onDismiss}
      recent={recent}
    />,
  )
  const field = screen.getByRole('combobox', { name: 'Code block language' })
  return { ...result, field, onChoose, onDismiss, recent, user: userEvent.setup() }
}

// The popup is raised into the top layer where the browser can; jsdom cannot,
// so it reads as hidden here and every query includes hidden elements.
const listbox = () => screen.getByRole('listbox', { hidden: true })
const groupNames = () =>
  within(listbox())
    .getAllByRole('group', { hidden: true })
    .map((group) => group.getAttribute('aria-labelledby'))
    .map((id) => document.getElementById(id ?? '')?.textContent)

beforeEach(() => {
  localStorage.clear()
})

describe('the language picker', () => {
  it('shows the block’s language by name, and stays shut until asked', async () => {
    const { field, user } = picker('yml')
    expect(field).toHaveValue('YAML')
    await user.click(field)
    expect(field).toHaveAttribute('aria-expanded', 'false')
  })

  it('is a target at least 24px tall, and 44px on a coarse pointer', () => {
    const { field } = picker()
    // jsdom does no layout, so the size is read from the utilities that set it.
    expect(field).toHaveClass('h-6', 'pointer-coarse:h-11')
  })

  it('opens on Enter or Alt+ArrowDown, grouped by category with plain text first', async () => {
    const { field, user } = picker()
    field.focus()
    await user.keyboard('{Enter}')
    expect(field).toHaveAttribute('aria-expanded', 'true')
    expect(groupNames()).toEqual([
      'No language',
      'Web',
      'Systems',
      'Scripting',
      'Data',
      'Config',
      'Shell',
      'Markup',
      'Other',
    ])
    await user.keyboard('{Escape}')
    field.focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(field).toHaveAttribute('aria-expanded', 'true')
  })

  it('searches by name, fence name and extension, and chooses with Enter', async () => {
    const { field, onChoose, user } = picker()
    await user.type(field, 'golang')
    // Read by its text: jsdom leaves the popover shut, so it computes no names inside it.
    const [go] = within(listbox()).getAllByRole('option', { hidden: true })
    expect(go).toHaveTextContent('Go · golang')
    if (go === undefined) throw new Error('Nothing was offered.')
    // The fence name it was found by is shown beside the name, what matched marked.
    expect(go.querySelector('mark')).toHaveTextContent('golang')
    expect(go).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(onChoose).toHaveBeenLastCalledWith('go')

    await user.clear(field)
    await user.type(field, '.rs{Enter}')
    expect(onChoose).toHaveBeenLastCalledWith('rust')

    await user.clear(field)
    await user.type(field, 'sh{ArrowDown}')
    expect(screen.getByRole('status')).toHaveTextContent(/languages?$/u)
  })

  it('puts the languages chosen recently ahead of the rest', async () => {
    const recent = memoryRecents()
    const { field, user } = picker('ts', recent)
    await user.type(field, 'rust{Enter}')
    // Emptied, the field offers everything again.
    await user.clear(field)
    expect(groupNames().slice(0, 2)).toEqual(['No language', 'Recent'])
    expect(recent.read()).toEqual(['rust'])
  })

  it('does not remember a language the block would not take', async () => {
    const recent = memoryRecents()
    const { field, onChoose, user } = picker('ts', recent)
    onChoose.mockReturnValue(false)
    await user.type(field, 'rust{Enter}')
    expect(onChoose).toHaveBeenCalledWith('rust')
    expect(recent.read()).toEqual([])
  })

  it('keeps a fence name it does not know, as written', async () => {
    const { field, onChoose, user } = picker()
    await user.type(field, 'PowerShell{Enter}')
    expect(onChoose).toHaveBeenCalledWith('PowerShell')
  })

  it('says when nothing matches, and puts the language back on Enter', async () => {
    const { field, onChoose, user } = picker()
    await user.type(field, 'not a language')
    expect(screen.getByText('No language called “not a language”')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(field).toHaveValue('TypeScript')
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('gives the keyboard back to the code on Escape, open or shut', async () => {
    const { field, onDismiss, user } = picker()
    await user.type(field, 'Go')
    await user.keyboard('{Escape}')
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(field).toHaveValue('TypeScript')
  })

  it('writes nothing when the language chosen is the one the block has', async () => {
    const { field, onChoose, user } = picker('typescript')
    await user.type(field, 'TypeScript{Enter}')
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('keeps the author’s fence name when the same language is chosen under its name', async () => {
    const { field, onChoose, user } = picker('sh')
    expect(field).toHaveValue('Bash')
    await user.type(field, 'Bash{Enter}')
    expect(onChoose).not.toHaveBeenCalled()
    await user.clear(field)
    await user.type(field, 'python{Enter}')
    expect(onChoose).toHaveBeenCalledWith('python')
  })

  it('puts the language back when the field is left', async () => {
    const { field, user } = picker()
    await user.type(field, 'Ru')
    await user.tab()
    expect(field).toHaveValue('TypeScript')
  })

  it('has no accessibility violations, shut or open', async () => {
    const { container, field, user } = picker()
    await expectNoAccessibilityViolations(container)
    await user.type(field, 'S')
    await expectNoAccessibilityViolations(container)
  })
})

function codeMirror(): CodeMirrorView {
  const host = document.querySelector('.code-block-editor .cm-editor')
  const view = host instanceof HTMLElement ? CodeMirrorView.findFromDOM(host) : null
  if (view === null) throw new Error('The code block has no code editor in it.')
  return view
}

describe('the language picker in a document', () => {
  const SOURCE = ['```ts', 'const a = 1', '```', ''].join('\n')

  function open() {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument(SOURCE).ast} ref={ref} />)
    return { ref, user: userEvent.setup() }
  }

  it('changes the language as one undoable step, and colours the code at once', async () => {
    const { ref, user } = open()
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')
    const markdown = () =>
      serializeDocument({
        frontMatter: {},
        ast: ref.current?.toMdast() ?? { type: 'root', children: [] },
      })

    await waitFor(() => {
      expect(paintedRanges(codeMirror().state)[0]?.type).toBe('keyword')
    })
    const field = screen.getByRole('combobox', { name: 'Code block language' })
    await user.clear(field)
    await user.type(field, 'plain{Enter}')
    expect(markdown()).toContain('```\nconst a = 1')
    // Plain text is coloured as plain text in the same moment: nothing painted.
    expect(paintedRanges(codeMirror().state)).toEqual([])

    act(() => {
      undo(editor.state, editor.view.dispatch)
    })
    expect(markdown()).toContain('```ts\nconst a = 1')
    expect(paintedRanges(codeMirror().state)[0]).toEqual({ start: 0, end: 5, type: 'keyword' })
  })

  it('returns the keyboard to the code on Escape', async () => {
    const { user } = open()
    const field = screen.getByRole('combobox', { name: 'Code block language' })
    await user.click(field)
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(codeMirror().hasFocus).toBe(true)
    })
  })
})
