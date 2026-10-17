import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextSelection } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle, DocumentEditorProps } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { placeToolbar, toolbarArea, toolbarRoom } from './toolbar-position.ts'
import type { CommentRequest } from '../block/block-menu.tsx'
import { rangeBox } from '../link/open-link-popover.ts'
import { selectionBox } from './selection-box.ts'
import { describeSelection } from './selection-toolbar.tsx'

/**
 * The selection toolbar as a writer meets it: select words and it is there,
 * above them; type and it goes; Alt+F10 reaches it from the keyboard.
 */

type Extra = Partial<Omit<DocumentEditorProps, 'ast' | 'ref'>>

function open(markdown: string, extra: Extra = {}) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(markdown).ast} ref={ref} {...extra} />)
  const editor = () => {
    const current = ref.current?.editor
    if (current === null || current === undefined) throw new Error('No editor.')
    return current
  }
  const saved = (): string =>
    serializeDocument({
      frontMatter: {},
      ast: ref.current?.toMdast() ?? { type: 'root', children: [] },
    })
  /** Selects the first occurrence of `words`, as a finished drag or a double-click would. */
  const select = (words: string): void => {
    const state = editor().state
    let found: { from: number; to: number } | undefined
    state.doc.descendants((node, pos) => {
      const at = node.isText ? (node.text?.indexOf(words) ?? -1) : -1
      if (found === undefined && at >= 0) found = { from: pos + at, to: pos + at + words.length }
      return found === undefined
    })
    if (found === undefined) throw new Error(`No "${words}".`)
    const { from, to } = found
    act(() => {
      editor().view.dispatch(
        editor().state.tr.setSelection(TextSelection.create(editor().state.doc, from, to)),
      )
      editor().view.focus()
    })
  }
  return { ...result, ref, editor, saved, select, user: userEvent.setup() }
}

function toolbar(): HTMLElement {
  return screen.getByRole('toolbar', { name: 'Formatting' })
}

/**
 * Presses a toolbar button as a pointer does: over it, then down and up. The
 * tooltip a button wears draws its trigger afresh as it opens, so the button
 * is found again once the pointer is over it.
 */
async function press(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.hover(within(toolbar()).getByRole('button', { name }))
  await user.click(within(toolbar()).getByRole('button', { name }))
}

/** Which of the toolbar's controls has focus, found afresh: a button's tooltip draws it anew. */
function focused(): string | null {
  return document.activeElement?.getAttribute('data-control') ?? null
}

function hasToolbar(): boolean {
  return screen.queryByRole('toolbar', { name: 'Formatting' }) !== null
}

describe('when it appears', () => {
  it('appears over selected words, with every button named, and passes axe', async () => {
    const { select } = open('Some words here.\n')
    expect(hasToolbar()).toBe(false)
    select('words')
    const bar = toolbar()
    for (const name of [
      'Bold',
      'Italic',
      'Strikethrough',
      'Inline code',
      'Link',
      'Small print',
      'Badge',
      'Clear formatting',
      'Copy link to section',
      'Comment',
    ]) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(within(bar).getByRole('button', { name: 'Turn into, now Text' })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    )
    await expectNoAccessibilityViolations(bar)
  })

  it('shows what is on, and says why what cannot act is disabled', () => {
    const { select } = open('Some **bold** words.\n')
    select('bold')
    expect(within(toolbar()).getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(toolbar()).getByRole('button', { name: 'Italic' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    const comment = within(toolbar()).getByRole('button', { name: 'Comment' })
    expect(comment).toHaveAttribute('aria-disabled', 'true')
  })

  it('waits for a drag to finish before it appears', () => {
    const { select, editor } = open('Some words here.\n')
    fireEvent.pointerDown(editor().view.dom, { button: 0 })
    select('words')
    expect(hasToolbar()).toBe(false)
    fireEvent.pointerUp(window)
    expect(hasToolbar()).toBe(true)
  })

  it('goes on typing, on Escape, and when the document loses focus', async () => {
    const { select, editor, user } = open('Some words here.\n')
    select('words')
    act(() => {
      editor().view.dispatch(editor().state.tr.insertText('W'))
    })
    expect(hasToolbar()).toBe(false)
    select('here')
    expect(hasToolbar()).toBe(true)
    await user.keyboard('{Escape}')
    expect(hasToolbar()).toBe(false)
    select('Some')
    expect(hasToolbar()).toBe(true)
    act(() => {
      editor().view.dom.blur()
    })
    expect(hasToolbar()).toBe(false)
  })

  it('does not appear at a caret, in a code block, or in a table, whose toolbar is in charge', () => {
    const { select, editor } = open('Words.\n\n```\ncode here\n```\n\n| a |\n| - |\n| cell |\n')
    act(() => {
      editor().commands.setTextSelection(2)
      editor().view.focus()
    })
    expect(hasToolbar()).toBe(false)
    select('cell')
    expect(hasToolbar()).toBe(false)
    expect(describeSelection(editor().state)).toBeNull()
    act(() => {
      const { doc } = editor().state
      let code = 0
      doc.descendants((node, pos) => {
        if (node.type.name === 'codeBlock') code = pos
        return true
      })
      editor().view.dispatch(
        editor().state.tr.setSelection(TextSelection.create(doc, code + 1, code + 5)),
      )
    })
    expect(describeSelection(editor().state)).toBeNull()
  })
})

describe('what it does', () => {
  it('formats the selection and gives the words back their focus', async () => {
    const { select, user, saved, editor } = open('Make this bold.\n')
    select('this')
    await press(user, 'Bold')
    expect(saved()).toBe('Make **this** bold.\n')
    expect(editor().view.hasFocus()).toBe(true)
    await press(user, 'Clear formatting')
    expect(saved()).toBe('Make this bold.\n')
    await press(user, 'Small print')
    expect(saved()).toBe('Make :small[this] bold.\n')
  })

  it('does nothing when a disabled button is pressed', async () => {
    const { select, user, saved } = open('Plain words.\n')
    select('Plain')
    await press(user, 'Clear formatting')
    expect(saved()).toBe('Plain words.\n')
  })

  it('opens the link popover', async () => {
    const { select, user } = open('Link these words.\n')
    select('these')
    await press(user, 'Link')
    expect(await screen.findByRole('dialog', { name: 'Add link' })).toBeInTheDocument()
    expect(hasToolbar()).toBe(false)
  })

  it('turns the block into another from its menu', async () => {
    const { select, user, saved } = open('Words\n')
    select('Words')
    await press(user, 'Turn into, now Text')
    const menu = await screen.findByRole('menu', { name: 'Turn into' })
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Heading 1' }))
    expect(saved()).toBe('# Words\n')
  })

  it('copies a link to the section, and raises a comment on the words', async () => {
    const copied = vi.fn<(text: string) => Promise<void>>(async () => {})
    const comment = vi.fn<(request: CommentRequest) => void>()
    const { select, user } = open('## Set up\n\nInstall it.\n', {
      linkTo: (fragment) => `/d/1#${fragment}`,
      clipboard: { writeText: copied },
      onComment: comment,
    })
    select('Install')
    await press(user, 'Copy link to section')
    expect(copied).toHaveBeenCalledWith('/d/1#user-content-set-up')
    select('Install')
    await press(user, 'Comment')
    expect(comment).toHaveBeenCalledWith(expect.objectContaining({ text: 'Install' }))
  })
})

describe('the keyboard', () => {
  it('reaches it with Alt+F10, moves along it with the arrows, and Escape goes back', async () => {
    const { select, user, editor } = open('Some words here.\n')
    select('words')
    await user.keyboard('{Alt>}{F10}{/Alt}')
    expect(focused()).toBe('bold')
    await user.keyboard('{ArrowRight}')
    expect(focused()).toBe('italic')
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(focused()).toBe('comment')
    await user.keyboard('{Home}')
    expect(focused()).toBe('bold')
    await user.keyboard('{End}')
    expect(focused()).toBe('comment')
    await user.keyboard('a')
    expect(focused()).toBe('comment')
    await user.keyboard('{Escape}')
    expect(editor().view.hasFocus()).toBe(true)
    expect(hasToolbar()).toBe(false)
  })

  it('reaches it with Ctrl+Shift+\\ too, and stays shown while focus is in it', async () => {
    const { select, user } = open('Some words here.\n')
    select('words')
    await user.keyboard('{Control>}{Shift>}\\{/Shift}{/Control}')
    expect(within(toolbar()).getAllByRole('button')[0]).toHaveFocus()
    await user.tab()
  })

  it('leaves Alt+F10 to the page when there is no toolbar', async () => {
    const { user, editor } = open('Words.\n')
    act(() => {
      editor().commands.setTextSelection(2)
      editor().view.focus()
    })
    await user.keyboard('{Alt>}{F10}{/Alt}')
    expect(hasToolbar()).toBe(false)
  })
})

describe('placing it', () => {
  const viewport = { left: 0, right: 1440 }
  const size = { width: 400, height: 42 }

  it('goes above the words, centred on them', () => {
    const placement = placeToolbar({ top: 300, bottom: 320, left: 600, right: 700 }, size, viewport)
    expect(placement).toEqual({ side: 'above', top: 300 - 8 - 42, left: 450 })
  })

  it('goes below them when there is no room above, under the sticky bar too', () => {
    expect(placeToolbar({ top: 30, bottom: 50, left: 0, right: 10 }, size, viewport).side).toBe(
      'below',
    )
    expect(
      placeToolbar({ top: 100, bottom: 120, left: 0, right: 10 }, size, viewport, 64),
    ).toMatchObject({ side: 'below', top: 128 })
  })

  it('never runs off either side', () => {
    expect(placeToolbar({ top: 300, bottom: 320, left: 0, right: 10 }, size, viewport).left).toBe(8)
    expect(
      placeToolbar({ top: 300, bottom: 320, left: 1430, right: 1440 }, size, viewport).left,
    ).toBe(1440 - 400 - 8)
    expect(
      placeToolbar({ top: 300, bottom: 320, left: 0, right: 10 }, size, { left: 0, right: 300 })
        .left,
    ).toBe(8)
  })

  it('stays inside the main region, never over the sidebar beside it', () => {
    const main = { left: 352, right: 1440 }
    expect(placeToolbar({ top: 300, bottom: 320, left: 400, right: 460 }, size, main).left).toBe(
      352 + 8,
    )
  })

  it('keeps to the main region, and to the screen only when the region is too narrow to use', () => {
    expect(toolbarArea({ left: 352, right: 1600 }, 1440)).toEqual({ left: 352, right: 1440 })
    expect(toolbarArea({ left: -20, right: 900 }, 1440)).toEqual({ left: 0, right: 900 })
    // Narrower than the toolbar: it stays over the region and scrolls sideways, as on a phone.
    expect(toolbarArea({ left: 376, right: 768 }, 768)).toEqual({ left: 376, right: 768 })
    expect(toolbarArea({ left: 600, right: 768 }, 768)).toEqual({ left: 0, right: 768 })
    expect(toolbarArea(undefined, 390)).toEqual({ left: 0, right: 390 })
  })

  it('is never wider than its area', () => {
    expect(toolbarRoom({ left: 376, right: 768 })).toBe(768 - 376 - 16)
  })

  it('measures the words on one line, and the column for several', () => {
    const { editor } = open('Words over\n\ntwo lines.\n')
    const view = editor().view
    vi.spyOn(view, 'coordsAtPos').mockImplementation((pos) =>
      pos === 1
        ? { top: 10, bottom: 20, left: 5, right: 6 }
        : { top: 30, bottom: 40, left: 50, right: 60 },
    )
    vi.spyOn(view.dom, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, width: 700 }),
    )
    expect(selectionBox(view, 1, 1)).toEqual({ top: 10, bottom: 20, left: 5, right: 6 })
    expect(selectionBox(view, 1, 2)).toEqual({ top: 10, bottom: 40, left: 0, right: 700 })
    expect(rangeBox(view, 1, 2)).toEqual({ x: 0, y: 10, width: 700, height: 30 })
  })
})

describe('the keys beside the toolbar', () => {
  it('clears formatting with Ctrl+backslash and moves the block with Ctrl+Shift+arrows', async () => {
    const { select, user, saved } = open('One.\n\nMake **this** bold.\n')
    select('this')
    await user.keyboard('{Control>}\\{/Control}')
    expect(saved()).toBe('One.\n\nMake this bold.\n')
    await user.keyboard('{Control>}{Shift>}{ArrowUp}{/Shift}{/Control}')
    expect(saved()).toBe('Make this bold.\n\nOne.\n')
    await user.keyboard('{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}')
    expect(saved()).toBe('One.\n\nMake this bold.\n')
  })
})
