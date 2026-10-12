import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CommentRequest } from '../block/comment-request.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { CellSelection, TableMap } from 'prosemirror-tables'

import { selectLine, selectTable } from '../table/table-commands.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

const TABLE = ['| Name | Count |', '| - | - |', '| pear | 10 |', '| fig | 2 |', ''].join('\n')

interface OpenOptions {
  readonly onComment?: (request: CommentRequest) => void
  readonly editable?: boolean
}

function open(source: string, { onComment, editable }: OpenOptions = {}) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(
    <DocumentEditor
      ast={parseDocument(source).ast}
      ref={ref}
      {...(onComment === undefined ? {} : { onComment })}
      {...(editable === undefined ? {} : { editable })}
    />,
  )
  return { ref, user: userEvent.setup(), ...result }
}

type Opened = ReturnType<typeof open>

function editorOf(opened: Opened) {
  const editor = opened.ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  return editor
}

function markdown(opened: Opened): string {
  const handle = opened.ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

/** Selects the first occurrence of `text`, or puts the caret `offset` characters into it. */
function select(opened: Opened, text: string, offset?: number): void {
  const editor = editorOf(opened)
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text?.indexOf(text) ?? -1) : -1
    if (from < 0 && at >= 0) from = pos + at
  })
  if (from < 0) throw new Error(`"${text}" is not in the document.`)
  act(() => {
    editor.view.focus()
    if (offset === undefined)
      editor
        .chain()
        .setTextSelection({ from, to: from + text.length })
        .run()
    else
      editor
        .chain()
        .setTextSelection(from + offset)
        .run()
  })
}

/** A right-click at a point in the viewport, or the keyboard's Menu key when it has none. */
function rightClick(
  opened: Opened,
  at: { x: number; y: number } | null = { x: 40, y: 60 },
): boolean {
  const surface = screen.getByRole('textbox', { name: 'Document' })
  let allowed = true
  act(() => {
    allowed = fireEvent.contextMenu(
      surface,
      at === null ? { clientX: 0, clientY: 0 } : { clientX: at.x, clientY: at.y },
    )
  })
  void opened
  return allowed
}

const menu = (): HTMLElement => screen.getByRole('menu', { name: 'Context menu' })
const sections = (): string[] =>
  within(menu())
    .getAllByRole('group')
    .map((group) => group.getAttribute('aria-labelledby'))
    .map((id) => (id === null ? '' : (document.getElementById(id)?.textContent ?? '')))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the context menu', () => {
  it('replaces the browser’s menu over the writing surface', () => {
    const opened = open('Some text.\n')
    select(opened, 'text')
    expect(rightClick(opened)).toBe(false)
    expect(menu()).toBeVisible()
  })

  it('leaves the browser’s menu to Shift + right-click, where spelling and the clipboard live', () => {
    const opened = open('Some text.\n')
    select(opened, 'text')
    const surface = screen.getByRole('textbox', { name: 'Document' })
    expect(fireEvent.contextMenu(surface, { shiftKey: true })).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not take over a document that cannot be edited', () => {
    const opened = open('Some text.\n', { editable: false })
    expect(rightClick(opened)).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('is accessible', async () => {
    const opened = open('Some text.\n')
    select(opened, 'text')
    rightClick(opened)
    await expectNoAccessibilityViolations(opened.container)
  })

  it('opens at the caret for the keyboard’s Menu key, which has no pointer position', () => {
    const opened = open('Some text.\n')
    select(opened, 'text', 2)
    rightClick(opened, null)
    expect(menu()).toBeVisible()
  })
})

describe('where the caret goes when the author right-clicks', () => {
  function pointAt(opened: Opened, pos: number): void {
    vi.spyOn(editorOf(opened).view, 'posAtCoords').mockReturnValue({ pos, inside: -1 })
  }

  it('moves to where was clicked, when that is outside the selection', () => {
    const opened = open('Some text here.\n')
    select(opened, 'Some')
    pointAt(opened, 12)
    rightClick(opened)
    const { selection } = editorOf(opened).state
    expect(selection.empty).toBe(true)
    expect(selection.from).toBe(12)
  })

  it('keeps a selection that was clicked inside, because the menu is about it', () => {
    const opened = open('Some text here.\n')
    select(opened, 'text')
    pointAt(opened, 7)
    rightClick(opened)
    const { selection } = editorOf(opened).state
    expect([selection.from, selection.to]).toEqual([6, 10])
  })

  it('leaves the caret alone when the browser cannot say what was clicked', () => {
    const opened = open('Some text here.\n')
    select(opened, 'Some')
    vi.spyOn(editorOf(opened).view, 'posAtCoords').mockReturnValue(null)
    rightClick(opened)
    expect(editorOf(opened).state.selection.to).toBe(5)
    expect(menu()).toBeVisible()
  })

  it('does not move the caret for a menu raised from the keyboard, which clicked nowhere', () => {
    const opened = open('Some text here.\n')
    select(opened, 'text', 2)
    pointAt(opened, 1)
    rightClick(opened, null)
    expect(editorOf(opened).state.selection.from).toBe(8)
  })
})

describe('what it offers, by where the author pointed', () => {
  it('offers formatting, a link and a way to turn selected text into something else', () => {
    const opened = open('Some text.\n')
    select(opened, 'text')
    rightClick(opened)
    expect(sections()).toEqual([
      'Clipboard',
      'Link',
      'Format',
      'Turn into',
      'Put in a callout',
      'Block',
    ])
    expect(within(menu()).getByRole('menuitemcheckbox', { name: /Bold/ })).toBeVisible()
    expect(within(menu()).getByRole('menuitemradio', { name: /Heading 2/ })).toBeVisible()
  })

  it('offers no formatting for a caret in plain text, only what applies to the block', () => {
    const opened = open('Some text.\n')
    select(opened, 'text', 1)
    rightClick(opened)
    expect(sections()).toEqual(['Turn into', 'Block'])
  })

  it('offers a table its rows, columns, and alignment, and no styles for a cell', () => {
    const opened = open(TABLE)
    select(opened, 'pear', 1)
    rightClick(opened)
    expect(sections()).toEqual(['Row', 'Column', 'Alignment', 'Table', 'Block'])
  })

  it('offers a callout its variants and its removal', () => {
    const opened = open(':::callout{type=info}\nBody.\n:::\n')
    select(opened, 'Body', 1)
    rightClick(opened)
    expect(sections()).toEqual(['Turn into', 'Callout type', 'Callout', 'Block'])
    expect(within(menu()).getByRole('menuitemradio', { name: /Info/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('offers a link its own tools', () => {
    const opened = open('Read [the docs](https://example.com) now.\n')
    select(opened, 'the docs', 3)
    rightClick(opened)
    expect(sections()[0]).toBe('Link')
    for (const name of ['Link…', 'Open link', 'Copy link address', 'Remove link']) {
      expect(within(menu()).getByRole('menuitem', { name })).toBeVisible()
    }
  })

  it('offers a comment only when somebody is listening', () => {
    const quiet = open('Some text.\n')
    select(quiet, 'text', 1)
    rightClick(quiet)
    expect(within(menu()).queryByRole('menuitem', { name: 'Add comment' })).toBeNull()
    quiet.unmount()

    const listening = open('Some text.\n', {
      onComment: vi.fn<(request: CommentRequest) => void>(),
    })
    select(listening, 'text', 1)
    rightClick(listening)
    expect(within(menu()).getByRole('menuitem', { name: 'Add comment' })).toBeVisible()
  })

  it('disables what cannot be done here instead of hiding it from the group it belongs to', () => {
    const opened = open('First.\n\nSecond.\n')
    select(opened, 'First', 1)
    rightClick(opened)
    expect(within(menu()).getByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(menu()).getByRole('menuitem', { name: 'Move down' })).not.toHaveAttribute(
      'aria-disabled',
    )
  })
})

describe('choosing from it', () => {
  it('formats the selection and closes', async () => {
    const opened = open('Some text.\n')
    select(opened, 'text')
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitemcheckbox', { name: /Bold/ }))
    expect(markdown(opened)).toBe('Some **text**.\n')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(editorOf(opened).isFocused).toBe(true)
  })

  it('shows the key beside an action that has one', () => {
    const opened = open('Some text.\n')
    select(opened, 'text')
    rightClick(opened)
    const bold = within(menu()).getByRole('menuitemcheckbox', { name: /Bold/ })
    expect(within(bold).getByText(/^(Ctrl\+B|⌘B)$/)).toBeVisible()
  })

  it('works a table from its menu', async () => {
    const opened = open(TABLE)
    select(opened, 'pear', 1)
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Insert column right' }))
    expect(markdown(opened)).toContain('| Name | | Count |')
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitemradio', { name: 'Align centre' }))
    expect(markdown(opened)).toContain('| :-: | - | - |')
  })

  it('changes a callout’s variant', async () => {
    const opened = open(':::callout{type=info}\nBody.\n:::\n')
    select(opened, 'Body', 1)
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitemradio', { name: /Caution/ }))
    expect(markdown(opened)).toContain('type="caution"')
  })

  it('puts selected text in a callout', async () => {
    const opened = open('Some text.\n')
    select(opened, 'text')
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitem', { name: /Tip/ }))
    expect(markdown(opened)).toBe('> [!TIP]\n> Some text.\n')
  })

  it('moves a block', async () => {
    const opened = open('First.\n\nSecond.\n')
    select(opened, 'First', 1)
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Move down' }))
    expect(markdown(opened)).toBe('Second.\n\nFirst.\n')
  })

  it('raises a comment on the selection', async () => {
    const onComment = vi.fn<(request: CommentRequest) => void>()
    const opened = open('Some text.\n', { onComment })
    select(opened, 'text')
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Add comment' }))
    expect(onComment).toHaveBeenCalledWith(expect.objectContaining({ text: 'text' }))
  })

  it('opens the link box for Link…, from the menu', async () => {
    const opened = open('Some text.\n')
    select(opened, 'text')
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Link…' }))
    expect(screen.getByRole('textbox', { name: 'Link address' })).toHaveFocus()
  })

  it('removes a link, copies its address, and opens it only when asked', async () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null)
    const opened = open('Read [the docs](https://example.com) now.\n')
    select(opened, 'the docs', 3)

    rightClick(opened)
    // Asking whether they are available must not have done them.
    expect(openWindow).not.toHaveBeenCalled()
    expect(await navigator.clipboard.readText()).toBe('')
    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Copy link address' }))
    expect(await navigator.clipboard.readText()).toBe('https://example.com')

    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Open link' }))
    expect(openWindow).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')

    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Remove link' }))
    expect(markdown(opened)).toBe('Read the docs now.\n')
  })

  it('opens a link within the site in the same tab', async () => {
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null)
    const opened = open('Read [the docs](/guide) now.\n')
    select(opened, 'the docs', 3)
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Open link' }))
    expect(openWindow).toHaveBeenCalledWith('/guide', '_self', 'noopener,noreferrer')
  })

  it('does nothing when a disabled item is chosen, and stays open', async () => {
    const opened = open('First.\n\nSecond.\n')
    select(opened, 'First', 1)
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Move up' }))
    expect(markdown(opened)).toBe('First.\n\nSecond.\n')
    expect(menu()).toBeVisible()
  })
})

describe('using it from the keyboard', () => {
  it('takes focus, moves with the arrows, and chooses with Enter', async () => {
    const opened = open('First.\n\nSecond.\n')
    select(opened, 'First', 1)
    rightClick(opened)
    expect(menu()).toHaveFocus()
    // The first item that does something here is "Text", then "Heading 1"…
    const items = within(menu()).getAllByRole('menuitemradio')
    await opened.user.keyboard('{ArrowDown}')
    expect(menu()).toHaveAttribute('aria-activedescendant', items[1]?.id)
    await opened.user.keyboard('{Enter}')
    expect(markdown(opened)).toBe('# First.\n\nSecond.\n')
  })

  it('chooses with Space, as a button is', async () => {
    const opened = open('First.\n\nSecond.\n')
    select(opened, 'First', 1)
    rightClick(opened)
    // Text, Heading 1, then Heading 2.
    await opened.user.keyboard('{ArrowDown}{ArrowDown} ')
    expect(markdown(opened)).toBe('## First.\n\nSecond.\n')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape and gives focus back to the document', async () => {
    const opened = open('Some text.\n')
    select(opened, 'text', 1)
    rightClick(opened)
    await opened.user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(editorOf(opened).isFocused).toBe(true)
  })

  it('closes on Tab rather than letting focus wander off behind it', async () => {
    const opened = open('Some text.\n')
    select(opened, 'text', 1)
    rightClick(opened)
    await opened.user.keyboard('{Tab}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on a click elsewhere, without taking focus from what was clicked', async () => {
    const opened = open('Some text.\n')
    select(opened, 'text', 1)
    rightClick(opened)
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    await opened.user.click(elsewhere)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(elsewhere).toHaveFocus()
    elsewhere.remove()
  })

  it('does not open a second browser menu over itself', () => {
    const opened = open('Some text.\n')
    select(opened, 'text', 1)
    rightClick(opened)
    expect(fireEvent.contextMenu(menu())).toBe(false)
  })
})

/** Selects cells with the command a grip runs. */
function selectCells(opened: Opened, command: ReturnType<typeof selectTable>): void {
  const editor = editorOf(opened)
  act(() => {
    editor.view.focus()
    command(editor.state, editor.view.dispatch)
  })
}

/** The cell the text is in, as the position of its text. */
function textPos(opened: Opened, text: string): number {
  let at = -1
  editorOf(opened).state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === text) at = pos
  })
  return at
}

/** Selects the block of cells from one corner to the other, by row and column. */
function selectBlock(opened: Opened, from: [number, number], to: [number, number]): void {
  const editor = editorOf(opened)
  const map = TableMap.get(editor.state.doc.child(0))
  const at = ([row, column]: [number, number]): number =>
    1 + (map.map[row * map.width + column] ?? 0)
  act(() => {
    editor.view.focus()
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, at(from), at(to))),
    )
  })
}

const items = (): string[] =>
  within(menu())
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '')

describe('with cells selected', () => {
  it('offers the whole table copy, clear, alignment and the table, and no row or column of it', () => {
    const opened = open(TABLE)
    selectCells(opened, selectTable(0))
    rightClick(opened)

    expect(sections()).toEqual(['Clipboard', 'Cells', 'Alignment', 'Table', 'Block'])
    expect(items()).not.toContain('Select table')
    expect(items()).not.toContain('Copy table as Markdown')
    expect(items()).toContain('Copy as Markdown')
  })

  it('offers a row what is done with a row, and nothing about columns', () => {
    const opened = open(TABLE)
    selectCells(opened, selectLine('row', 1, 0))
    rightClick(opened)

    expect(sections()).toEqual(['Clipboard', 'Cells', 'Row', 'Table', 'Block'])
    expect(items()).toEqual(
      expect.arrayContaining([
        'Insert row above',
        'Insert row below',
        'Move row up',
        'Move row down',
        'Delete row',
        'Copy table as Markdown',
      ]),
    )
    expect(items()).not.toContain('Select row')
    expect(items()).not.toContain('Select table')
  })

  it('offers a column what is done with a column, and its alignment', () => {
    const opened = open(TABLE)
    selectCells(opened, selectLine('column', 1, 0))
    rightClick(opened)

    expect(sections()).toEqual(['Clipboard', 'Cells', 'Column', 'Alignment', 'Table', 'Block'])
    expect(items()).toEqual(
      expect.arrayContaining(['Insert column left', 'Insert column right', 'Delete column']),
    )
  })

  it('names rows in the plural when there are several, and moves none of them', () => {
    const opened = open(`${TABLE}| kiwi | 7 |\n`)
    selectBlock(opened, [1, 0], [2, 1])
    rightClick(opened)

    expect(sections()).toEqual(['Clipboard', 'Cells', 'Rows', 'Table', 'Block'])
    expect(items()).toContain('Delete rows')
    expect(items()).not.toContain('Delete row')
    expect(items()).not.toContain('Move row up')
    expect(items()).not.toContain('Move row down')
  })

  it('names columns in the plural when there are several, and moves none of them', () => {
    const opened = open('| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n')
    selectBlock(opened, [0, 0], [1, 1])
    rightClick(opened)

    expect(items()).not.toContain('Move column left')
    expect(items()).not.toContain('Move column right')
    expect(items()).toContain('Delete columns')
  })

  it('offers a patch of cells the rows and columns it spans, and what is done with the cells', () => {
    const opened = open('| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n')
    selectBlock(opened, [1, 1], [2, 1])
    rightClick(opened)

    expect(sections()).toEqual([
      'Clipboard',
      'Cells',
      'Rows',
      'Column',
      'Alignment',
      'Table',
      'Block',
    ])
    expect(items()).toEqual(expect.arrayContaining(['Delete rows', 'Delete column']))
    expect(items()).not.toContain('Select column')
  })

  it('offers a caret what it did, with the way to pick out its row, column and table', () => {
    const opened = open(TABLE)
    select(opened, 'pear', 1)
    rightClick(opened)

    expect(items()).toEqual(
      expect.arrayContaining([
        'Select row',
        'Select column',
        'Select table',
        'Copy table as Markdown',
      ]),
    )
    expect(items()).not.toContain('Clear cells')
  })

  it('clears the cells and keeps the table', async () => {
    const opened = open(TABLE)
    selectCells(opened, selectLine('row', 1, 0))
    rightClick(opened)

    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Clear cells' }))

    expect(markdown(opened)).toContain('| Name | Count |')
    expect(markdown(opened)).not.toContain('pear')
    expect(markdown(opened)).toContain('| fig | 2 |')
  })

  it('deletes the selected row', async () => {
    const opened = open(TABLE)
    selectCells(opened, selectLine('row', 1, 0))
    rightClick(opened)
    await opened.user.click(within(menu()).getByRole('menuitem', { name: 'Delete row' }))

    expect(markdown(opened)).not.toContain('pear')
    expect(markdown(opened)).toContain('| fig | 2 |')
  })

  it('keeps the cells that were clicked in, because the menu is about them', () => {
    const opened = open(TABLE)
    selectCells(opened, selectTable(0))
    vi.spyOn(editorOf(opened).view, 'posAtCoords').mockReturnValue({
      pos: textPos(opened, 'fig'),
      inside: -1,
    })

    rightClick(opened)

    expect(editorOf(opened).state.selection.constructor.name).toBe('CellSelection')
  })

  it('moves to a cell that was clicked outside the cells, even between two that are selected', () => {
    const opened = open(TABLE)
    // A column, whose first and last cells have the whole second column between them.
    selectCells(opened, selectLine('column', 0, 0))
    vi.spyOn(editorOf(opened).view, 'posAtCoords').mockReturnValue({
      pos: textPos(opened, '10'),
      inside: -1,
    })

    rightClick(opened)

    const { selection } = editorOf(opened).state
    expect(selection.constructor.name).toBe('TextSelection')
    expect(selection.empty).toBe(true)
  })
})
