import { parseDocument } from '@quill/markdown'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextSelection } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { MenuAction, MenuEntry, MenuPlace } from '../context-menu/context-menu-registry.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { shortcutFor } from '../format/shortcuts.ts'
import { findMenu, findSelectionUnavailable } from './find-menu.ts'
import { findStateOf } from './find-plugin.ts'

/**
 * Find from the menus: "Find and replace…" in the context menu anywhere, and "Find in document"
 * for selected words, in the context menu and on the selection toolbar, with the keys shown.
 */

const NL = String.fromCharCode(10)
const DOC = 'The plan is a plan.' + NL + NL + 'Another line.' + NL

function mount() {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(DOC).ast} ref={ref} />)
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('No editor.')
  const select = (from: number, to: number) => {
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
      )
      editor.view.focus()
    })
  }
  return { editor, select, user: userEvent.setup() }
}

function placeIn(editor: ReturnType<typeof mount>['editor']): MenuPlace {
  return {
    view: editor.view,
    state: editor.state,
    pos: editor.state.selection.from,
    environment: {},
    editor: { editLink: vi.fn<() => void>(), editAltText: vi.fn<(pos: number) => void>() },
  }
}

function action(entries: readonly MenuEntry[], id: string): MenuAction {
  const found = entries.find((entry) => entry.id === id)
  if (found?.kind !== 'action') throw new Error(`No action "${id}".`)
  return found
}

const ids = (entries: readonly MenuEntry[]) => entries.map((entry) => entry.id)

describe('find in the context menu', () => {
  it('offers find and replace at a caret, with its key', () => {
    const { editor, select } = mount()
    select(3, 3)

    const entries = findMenu.entries(placeIn(editor))

    expect(ids(entries)).toEqual(['find-and-replace'])
    expect(action(entries, 'find-and-replace')).toMatchObject({
      label: 'Find and replace…',
      shortcut: shortcutFor('replace'),
    })
  })

  it('offers to find the selected words first, with its key', () => {
    const { editor, select } = mount()
    select(5, 9)

    const entries = findMenu.entries(placeIn(editor))

    expect(ids(entries)).toEqual(['find-in-document', 'find-and-replace'])
    expect(action(entries, 'find-in-document')).toMatchObject({
      label: 'Find in document',
      shortcut: shortcutFor('find'),
      disabledReason: undefined,
    })
  })

  it('says why words across two lines cannot be found', () => {
    const { editor, select } = mount()
    select(5, 25)

    expect(action(findMenu.entries(placeIn(editor)), 'find-in-document').disabledReason).toBe(
      'Select words on one line to find them',
    )
    expect(findSelectionUnavailable(editor.state)).toBeDefined()
  })

  it('opens the bar on the selected words, and with the replace row, from the entries', () => {
    const { editor, select } = mount()
    select(5, 9)

    act(() => {
      action(findMenu.entries(placeIn(editor)), 'find-in-document').run()
    })
    expect(findStateOf(editor.state)).toMatchObject({ open: true, replacing: false, query: 'plan' })

    act(() => {
      action(findMenu.entries(placeIn(editor)), 'find-and-replace').run()
    })
    expect(findStateOf(editor.state)).toMatchObject({ open: true, replacing: true })
  })

  it('opens the bar with the keyboard in it when chosen from the menu itself', async () => {
    const { select, user } = mount()
    select(5, 9)

    await user.keyboard('{Shift>}{F10}{/Shift}')
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: /Find in document/u }))

    const bar = screen.getByRole('search', { name: 'Find and replace' })
    const field = within(bar).getByRole('textbox', { name: 'Find' })
    expect(field).toHaveValue('plan')
    await waitFor(() => {
      expect(field).toHaveFocus()
    })
  })
})

describe('find on the selection toolbar', () => {
  it('has a find button, with its key, that opens the bar on the selected words', async () => {
    const { select, user } = mount()
    select(5, 9)

    const toolbar = await screen.findByRole('toolbar', { name: 'Formatting' })
    const button = within(toolbar).getByRole('button', { name: 'Find in document' })
    await user.click(button)

    const bar = screen.getByRole('search', { name: 'Find and replace' })
    expect(within(bar).getByRole('textbox', { name: 'Find' })).toHaveValue('plan')
  })
})
