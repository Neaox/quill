import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { undo } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { CellSelection } from 'prosemirror-tables'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { tableAction, tableActions, tableKeymap, TABLE_ACTIONS } from './table-actions.ts'
import { ariaKeyShortcut, placement, TableToolbar } from './table-toolbar.tsx'

const SOURCE = [
  'Before the table.',
  '',
  ':::table[Services]{headers=both footer=1}',
  '| Service | Owner | Requests |',
  '| :- | - | -: |',
  '| Gateway | Platform | 12,400 |',
  '| Search | Discovery | 8,210 |',
  '| Total | | 20,610 |',
  ':::',
  '',
  '| Field | Count |',
  '| - | - |',
  '| id | 1 |',
  '| title | 2 |',
  '',
].join('\n')

function open(source = SOURCE) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const editor = ref.current?.editor
  if (editor == null) throw new Error('The editor did not start.')
  return { ...result, ref, editor }
}

/** The Markdown the editor would save. */
function written(ref: { readonly current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

/** Puts the caret in the cell holding `text`. */
function caretIn(editor: Editor, text: string): void {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text === text) at = pos
  })
  if (at === -1) throw new Error(`no cell ${text}`)
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)))
  })
}

/** A box on the screen, as `getBoundingClientRect` gives it. */
function box(top: number, bottom: number, left = 40): DOMRect {
  return DOMRect.fromRect({ x: left, y: top, width: 600, height: bottom - top })
}

/**
 * A toolbar button, once its hint has loaded: a hinted control is drawn again
 * when the pointer first reaches it (`Tooltip`), so it is pointed at first.
 */
async function hinted(toolbar: HTMLElement, name: string): Promise<HTMLElement> {
  await userEvent.hover(within(toolbar).getByRole('button', { name }))
  return within(toolbar).getByRole('button', { name })
}

/** Waits for focus on the control named `name`: a hinted control is redrawn when its hint arrives. */
async function focused(name: string): Promise<void> {
  await waitFor(() => {
    expect(document.activeElement).toHaveAccessibleName(name)
  })
}

async function press(toolbar: HTMLElement, name: string): Promise<void> {
  await userEvent.click(await hinted(toolbar, name))
}

/** Chooses an option in the open menu. */
async function choose(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('menuitemradio', { name }))
}

function rows(table: HTMLElement): HTMLTableRowElement[] {
  return [...table.querySelectorAll('tr')]
}

describe('a table as it is written', () => {
  it('marks the header row, the footer, the row headers and each column, as the reader does', () => {
    open()
    const [first] = screen.getAllByRole('table')
    if (first === undefined) throw new Error('no table')
    const [head, gateway, , total] = rows(first)

    expect(head).toHaveAttribute('data-part', 'head')
    expect(total).toHaveAttribute('data-part', 'foot')
    expect(gateway).not.toHaveAttribute('data-part')
    expect(gateway?.cells[0]).toHaveAttribute('data-part', 'row-header')
    expect(gateway?.cells[0]).toHaveClass('align-left')
    expect(gateway?.cells[2]).toHaveClass('align-right')
  })

  it('sets a column of numbers flush right until its author says otherwise', () => {
    open()
    const second = screen.getAllByRole('table')[1]
    if (second === undefined) throw new Error('no table')
    const [, row] = rows(second)

    expect(row?.cells[1]).toHaveClass('align-numeric')
    expect(row?.cells[0]).not.toHaveClass('align-numeric')
    expect(rows(second)[0]).toHaveAttribute('data-part', 'head')
  })

  it('marks again only the table a change touched, and follows its wrapper', () => {
    const { editor } = open()
    caretIn(editor, '1')
    act(() => {
      editor.commands.insertContent('x')
    })
    const second = screen.getAllByRole('table')[1]
    expect(second && rows(second)[1]?.cells[1]).not.toHaveClass('align-numeric')

    caretIn(editor, 'Gateway')
    act(() => {
      tableAction(editor.state, 'footer-row')?.command(editor.state, editor.view.dispatch)
    })
    const first = screen.getAllByRole('table')[0]
    expect(first && rows(first).at(-1)).not.toHaveAttribute('data-part')
  })

  it('marks the table the caret is in, so its handles stay in view', () => {
    const { editor } = open()
    const [first, second] = screen.getAllByRole('table')
    caretIn(editor, 'Search')

    expect(first?.closest('.table-editor')).toHaveAttribute('data-active')
    expect(second?.closest('.table-editor')).not.toHaveAttribute('data-active')
  })
})

describe('the table toolbar', () => {
  it('is shown only while the caret is in a table, and passes an accessibility check', async () => {
    const { editor, container } = open()
    expect(screen.queryByRole('toolbar', { name: 'Table' })).toBeNull()

    caretIn(editor, 'Search')
    const toolbar = screen.getByRole('toolbar', { name: 'Table' })

    expect(within(toolbar).getByRole('button', { name: 'Header row' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(toolbar).getByRole('button', { name: 'Insert row above' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Alt+ArrowUp',
    )
    await expectNoAccessibilityViolations(container)
  })

  it('keeps a control that cannot act where it is, disabled, with its reason', async () => {
    const { editor } = open()
    caretIn(editor, 'Service')
    const toolbar = screen.getByRole('toolbar', { name: 'Table' })
    const remove = await hinted(toolbar, 'Delete row')

    expect(remove).toHaveAttribute('aria-disabled', 'true')
    const before = editor.state.doc
    await userEvent.click(remove)
    expect(editor.state.doc.eq(before)).toBe(true)
  })

  it('runs its commands on the table, each one undo step', async () => {
    const { editor, ref } = open()
    caretIn(editor, 'Search')
    const toolbar = screen.getByRole('toolbar', { name: 'Table' })
    await press(toolbar, 'Insert row below')

    expect(written(ref)).toContain('| Search | Discovery | 8,210 |\n| | | |')
    act(() => {
      undo(editor.state, editor.view.dispatch)
    })
    expect(written(ref)).not.toContain('| Search | Discovery | 8,210 |\n| | | |')
  })

  it('is one tab stop: the arrows move along it and Escape goes back to the cell', async () => {
    const { editor } = open()
    caretIn(editor, 'Search')
    const toolbar = screen.getByRole('toolbar', { name: 'Table' })
    const buttons = within(toolbar).getAllByRole('button')

    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1)
    buttons[0]?.focus()
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' })
    await focused('Header row')
    fireEvent.keyDown(toolbar, { key: 'End' })
    await focused('Delete table')
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' })
    await focused('Width: Wide')
    fireEvent.keyDown(toolbar, { key: 'q' })
    fireEvent.keyDown(toolbar, { key: 'Escape' })
    expect(editor.view.hasFocus()).toBe(true)
  })

  it('sits under the table, or at the bottom of the screen while the table runs past it', () => {
    const container = box(0, 2000, 0)

    expect(placement(box(100, 300), container, 36, 900)).toEqual({ top: 308, left: 40 })
    expect(placement(box(100, 1500), container, 36, 900)).toEqual({ top: 856, left: 40 })
    expect(placement(box(880, 1500), container, 36, 900)).toEqual({ top: 888, left: 40 })
  })
})

describe('the table toolbar’s menus', () => {
  it('sets the width from its menu, which names the width it has', async () => {
    const { editor, ref } = open()
    caretIn(editor, 'Search')
    await userEvent.click(screen.getByRole('button', { name: 'Width: Wide' }))
    await userEvent.click(
      await screen.findByRole('menuitemradio', { name: 'Full: the whole page' }),
    )
    expect(written(ref)).toContain('width="full"')

    // A choice leaves the menu open, so the next one is a click away.
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Wide: past the text' }))
    expect(written(ref)).not.toContain('width=')
  })

  it('sets what stays in view, how a phone shows it and whether readers sort it', async () => {
    const { editor, ref } = open()
    caretIn(editor, 'Search')
    await userEvent.click(screen.getByRole('button', { name: 'Reading options' }))

    await choose('Header row')
    expect(written(ref)).toContain('freeze="header"')
    await choose('First column')
    expect(written(ref)).toContain('freeze="first-column"')
    await choose('Header row and first column')
    expect(written(ref)).toContain('freeze="header,first-column"')
    expect(
      screen.getByRole('menuitemradio', { name: 'Header row and first column' }),
    ).toHaveAttribute('aria-checked', 'true')
    await choose('As the table needs')
    expect(written(ref)).not.toContain('freeze=')

    await choose('A card for each row')
    expect(written(ref)).toContain('responsive="stack"')
    await choose('Scroll sideways')
    expect(written(ref)).not.toContain('responsive=')

    await choose('Keep the written order')
    expect(written(ref)).toContain('sort="off"')
    await choose('Readers can sort by a column')
    expect(written(ref)).not.toContain('sort=')
  })

  it('names its keys for assistive technology, Command on Apple’s keyboards', () => {
    expect(ariaKeyShortcut('Mod-Alt-ArrowUp', false)).toBe('Control+Alt+ArrowUp')
    expect(ariaKeyShortcut('Mod-Alt-ArrowUp', true)).toBe('Meta+Alt+ArrowUp')
    expect(ariaKeyShortcut('Alt-ArrowUp', true)).toBe('Alt+ArrowUp')
  })

  it('draws nothing without an editor', () => {
    const { container } = render(<TableToolbar editor={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the table keyboard', () => {
  it('inserts, moves and deletes rows and columns from the keys the toolbar shows', () => {
    const { editor, ref } = open()
    caretIn(editor, 'Gateway')
    const keys = tableKeymap()

    act(() => {
      keys['Alt-ArrowDown']?.(editor.state, editor.view.dispatch)
    })
    expect(written(ref)).toMatch(/\| Search \| Discovery \| 8,210 \|\n\| Gateway/u)
    caretIn(editor, 'Owner')
    act(() => {
      keys['Mod-Alt-ArrowRight']?.(editor.state, editor.view.dispatch)
    })
    expect(written(ref)).toContain('| Service | Owner | | Requests |')
    caretIn(editor, 'Owner')
    act(() => {
      keys['Mod-Alt-Shift-Backspace']?.(editor.state, editor.view.dispatch)
    })
    expect(written(ref)).toContain('| Service | | Requests |')
  })

  it('declines outside a table, so the keys do what they do elsewhere', () => {
    const { editor } = open()
    caretIn(editor, 'Before the table.')

    expect(tableKeymap()['Mod-Alt-ArrowDown']?.(editor.state)).toBe(false)
    expect(tableActions(editor.state)).toEqual([])
  })

  it('lists every action once, with words for each', () => {
    const ids = TABLE_ACTIONS.map((action) => action.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(TABLE_ACTIONS.every((action) => action.label.length > 0)).toBe(true)
  })
})

describe('pasting into a table', () => {
  it('fills the cells from the caret’s, from a spreadsheet’s tab-separated copy', () => {
    const { editor, ref } = open()
    caretIn(editor, 'Platform')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? 'Infra\t1\nSearch team\t2' : ''),
      },
    })
    act(() => {
      editor.view.dom.dispatchEvent(paste)
    })

    expect(paste.defaultPrevented).toBe(true)
    expect(written(ref)).toContain('| Gateway | Infra | 1 |\n| Search | Search team | 2 |')
  })
})

describe('pasting words into a table', () => {
  it('leaves one line of words to the ordinary paste', () => {
    const { editor, ref } = open()
    caretIn(editor, 'Platform')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? 'Infra' : '') },
    })
    act(() => {
      editor.view.dom.dispatchEvent(paste)
    })

    expect(written(ref)).toContain('| Gateway | InfraPlatform | 12,400 |')
  })
})

describe('a table that cannot be edited', () => {
  it('takes no paste and shows no toolbar', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument(SOURCE).ast} ref={ref} editable={false} />)
    const editor = ref.current?.editor
    if (editor == null) throw new Error('The editor did not start.')
    caretIn(editor, 'Platform')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? 'a\tb' : '') },
    })
    editor.view.dom.dispatchEvent(paste)

    expect(paste.defaultPrevented).toBe(false)
    expect(screen.queryByRole('toolbar', { name: 'Table' })).toBeNull()
  })
})

describe('the table handles', () => {
  it('inserts a column at a boundary with its "+", and selects a column with its grip', () => {
    const { editor, ref, container } = open()
    const handles = container.querySelector('.table-handles')
    const inserts = handles?.querySelectorAll<HTMLButtonElement>('.table-insert-column') ?? []

    expect(inserts).toHaveLength(4)
    fireEvent.click(inserts[0] as HTMLButtonElement)
    expect(written(ref)).toContain('| | Service | Owner | Requests |')

    const grip = container.querySelector('.table-grip-column')
    fireEvent.pointerDown(grip as Element, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grip as Element, { clientX: 10, clientY: 10, pointerId: 1 })
    expect(editor.state.selection).toBeInstanceOf(CellSelection)
  })
})
