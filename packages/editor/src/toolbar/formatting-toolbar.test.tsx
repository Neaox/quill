import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { CommentRequest } from '../block/comment-request.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

function open(source: string, onComment?: (request: CommentRequest) => void) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(
    <DocumentEditor
      ast={parseDocument(source).ast}
      ref={ref}
      {...(onComment === undefined ? {} : { onComment })}
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
    if (offset === undefined) {
      editor.view.focus()
      editor
        .chain()
        .setTextSelection({ from, to: from + text.length })
        .run()
    } else {
      editor.view.focus()
      editor
        .chain()
        .setTextSelection(from + offset)
        .run()
    }
  })
}

const toolbar = (name?: string): HTMLElement => screen.getByRole('toolbar', name ? { name } : {})

describe('the floating toolbar over selected text', () => {
  it('appears with the selection, and is named for what it is', async () => {
    const opened = open('Say something clever.\n')
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    select(opened, 'something')
    const bar = toolbar('Text formatting')
    for (const name of ['Bold', 'Italic', 'Strikethrough', 'Code', 'Link…']) {
      expect(within(bar).getByRole('button', { name })).toBeVisible()
    }
    await expectNoAccessibilityViolations(opened.container)
  })

  it('goes away when the selection collapses', () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    select(opened, 'something', 2)
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('formats the selection without taking it away, and shows what is on', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    const bold = within(toolbar()).getByRole('button', { name: 'Bold' })
    expect(bold).toHaveAttribute('aria-pressed', 'false')
    await opened.user.click(bold)
    expect(markdown(opened)).toBe('Say **something** clever.\n')
    expect(within(toolbar()).getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Bold' }))
    expect(markdown(opened)).toBe('Say something clever.\n')
  })

  it('names the key bindings, because a toolbar is also where they are learned', () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    const bold = within(toolbar()).getByRole('button', { name: 'Bold' })
    expect(bold).toHaveAttribute('aria-keyshortcuts', 'Mod-b')
    expect(bold.getAttribute('title')).toMatch(/^Bold \((Ctrl\+B|⌘B)\)$/)
  })

  it('changes the kind of block from its style menu', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    const style = within(toolbar()).getByRole('button', { name: /Text/ })
    expect(style).toHaveAttribute('aria-haspopup', 'menu')
    await opened.user.click(style)
    const menu = screen.getByRole('menu', { name: 'Text style options' })
    expect(within(menu).getByRole('menuitemradio', { name: /^Text/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await opened.user.click(within(menu).getByRole('menuitemradio', { name: /Heading 2/ }))
    expect(markdown(opened)).toBe('## Say something clever.\n')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('names the current style on its button', () => {
    const opened = open('## A heading\n')
    select(opened, 'heading')
    expect(within(toolbar()).getByRole('button', { name: /Heading 2/ })).toBeVisible()
  })

  it('raises a comment on the selection when somebody is listening', async () => {
    const onComment = vi.fn<(request: CommentRequest) => void>()
    const opened = open('Say something clever.\n', onComment)
    select(opened, 'something')
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Add comment' }))
    expect(onComment).toHaveBeenCalledWith(expect.objectContaining({ text: 'something' }))
  })

  it('has no comment button when nobody is listening', () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    expect(within(toolbar()).queryByRole('button', { name: 'Add comment' })).toBeNull()
  })

  it('does not offer formatting inside a code block, where marks cannot go', () => {
    const opened = open('```\nsome code\n```\n')
    const editor = editorOf(opened)
    act(() => {
      editor.view.focus()
      editor.chain().setTextSelection({ from: 2, to: 6 }).run()
    })
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })
})

const names = (bar: HTMLElement): string[] =>
  within(bar)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '')

describe('the toolbar over selected text, laid out as other editors lay one out', () => {
  it('goes: style, marks, link, lists and quote, comment, more', () => {
    const opened = open('Say something clever.\n', () => undefined)
    select(opened, 'something')

    expect(names(toolbar('Text formatting'))).toEqual([
      'Text style: Text',
      'Bold',
      'Italic',
      'Strikethrough',
      'Code',
      'Link…',
      'Bulleted list',
      'Numbered list',
      'Task list',
      'Quote',
      'Add comment',
      'More formatting',
    ])
  })

  it('makes a list of the block with its button, and takes the list off with it again', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    const bullets = within(toolbar()).getByRole('button', { name: 'Bulleted list' })
    expect(bullets).toHaveAttribute('aria-pressed', 'false')

    await opened.user.click(bullets)
    expect(markdown(opened)).toBe('- Say something clever.\n')
    expect(within(toolbar()).getByRole('button', { name: 'Bulleted list' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Bulleted list' }))
    expect(markdown(opened)).toBe('Say something clever.\n')
  })

  it('has a button for each of the other lists and for a quote', async () => {
    const opened = open('Say something clever.\n')
    for (const [name, written] of [
      ['Numbered list', '1. Say something clever.\n'],
      ['Task list', '- [ ] Say something clever.\n'],
      ['Quote', '> Say something clever.\n'],
    ] as const) {
      select(opened, 'something')
      await opened.user.click(within(toolbar()).getByRole('button', { name }))
      expect(markdown(opened)).toBe(written)
      select(opened, 'something')
      await opened.user.click(within(toolbar()).getByRole('button', { name }))
    }
  })

  it('names the keys of the buttons that have them, because the toolbar is where they are learned', () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')

    expect(within(toolbar()).getByRole('button', { name: 'Numbered list' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Mod-Shift-7',
    )
  })

  it('clears the formatting from its more menu, and puts the words in a callout from it', async () => {
    const opened = open('Say **something** clever.\n')
    select(opened, 'something')

    await opened.user.click(within(toolbar()).getByRole('button', { name: 'More formatting' }))
    const menu = screen.getByRole('menu', { name: 'More formatting options' })
    await opened.user.click(within(menu).getByRole('menuitem', { name: 'Clear formatting' }))
    expect(markdown(opened)).toBe('Say something clever.\n')

    select(opened, 'something')
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'More formatting' }))
    await opened.user.click(screen.getByRole('menuitem', { name: /Tip/ }))
    expect(markdown(opened)).toContain('> [!TIP]')
  })
})

describe('making a link', () => {
  it('opens a box for the address, with focus in it', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Link…' }))
    expect(screen.getByRole('textbox', { name: 'Link address' })).toHaveFocus()
    await expectNoAccessibilityViolations(opened.container)
  })

  it('keeps the words being linked drawn as selected while the box has the keyboard', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    expect(opened.container.querySelector('.selection-held')).toBeNull()

    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Link…' }))

    expect(opened.container.querySelector('.selection-held')).toHaveTextContent('something')
  })

  it('lets go of them when the box is done with, however it is left', async () => {
    const opened = open('Say something clever.\n')
    for (const leave of ['{Escape}', 'example.com{Enter}']) {
      select(opened, 'something')
      await opened.user.click(within(toolbar()).getByRole('button', { name: 'Link…' }))
      await opened.user.keyboard(leave)

      expect(opened.container.querySelector('.selection-held')).toBeNull()
    }
  })

  it('holds the whole of a link while its address is edited, not only a caret in it', async () => {
    const opened = open('Read [the docs](https://example.com) now.\n')
    select(opened, 'the docs', 3)

    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Link…' }))

    expect(opened.container.querySelector('.selection-held')).toHaveTextContent('the docs')
  })

  it('links the selection to what was typed, completing a bare domain', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Link…' }))
    await opened.user.keyboard('example.com{Enter}')
    expect(markdown(opened)).toBe('Say [something](https://example.com) clever.\n')
    expect(screen.queryByRole('textbox', { name: 'Link address' })).not.toBeInTheDocument()
  })

  it('refuses an address a document may not carry, and says why beside the box', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Link…' }))
    await opened.user.keyboard('javascript:alert(1){Enter}')
    const box = screen.getByRole('textbox', { name: 'Link address' })
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(/web address/)
    expect(box).toHaveAccessibleDescription(/web address/)
    expect(markdown(opened)).toBe('Say something clever.\n')
    // Correcting it clears the complaint.
    await opened.user.clear(box)
    await opened.user.type(box, '/docs{Enter}')
    expect(markdown(opened)).toBe('Say [something](/docs) clever.\n')
  })

  it('gives up on Escape, and returns to the document with the selection intact', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Link…' }))
    await opened.user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Link address' })).not.toBeInTheDocument()
    expect(markdown(opened)).toBe('Say something clever.\n')
    expect(editorOf(opened).isFocused).toBe(true)
    expect(toolbar('Text formatting')).toBeVisible()
  })

  it('opens from the keyboard with Mod-K', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await opened.user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('textbox', { name: 'Link address' })).toBeVisible()
  })

  it('does not open for a caret that is in no link', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something', 2)
    await opened.user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('textbox', { name: 'Link address' })).not.toBeInTheDocument()
  })

  it('closes the box when the selection moves on, so it cannot reappear later', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Link…' }))
    select(opened, 'clever')
    expect(screen.queryByRole('textbox', { name: 'Link address' })).not.toBeInTheDocument()
    expect(within(toolbar()).getByRole('button', { name: 'Link…' })).toBeVisible()
  })
})

describe('a caret in a link', () => {
  const source = 'Read [the docs](https://example.com/guide) now.\n'

  it('shows where the link goes, as a link that opens elsewhere', () => {
    const opened = open(source)
    select(opened, 'the docs', 3)
    const bar = toolbar('Link')
    const address = within(bar).getByRole('link', { name: 'https://example.com/guide' })
    expect(address).toHaveAttribute('href', 'https://example.com/guide')
    expect(address).toHaveAttribute('rel', 'noopener noreferrer')
    expect(address).toHaveAttribute('target', '_blank')
  })

  it('removes the link', async () => {
    const opened = open(source)
    select(opened, 'the docs', 3)
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Remove link' }))
    expect(markdown(opened)).toBe('Read the docs now.\n')
  })

  it('edits the address, starting from the one it has', async () => {
    const opened = open(source)
    select(opened, 'the docs', 3)
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Link…' }))
    const box = screen.getByRole('textbox', { name: 'Link address' })
    expect(box).toHaveValue('https://example.com/guide')
    await opened.user.clear(box)
    await opened.user.type(box, 'https://example.org{Enter}')
    expect(markdown(opened)).toBe('Read [the docs](https://example.org) now.\n')
  })

  it('removes the link from the box as well', async () => {
    const opened = open(source)
    select(opened, 'the docs', 3)
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Link…' }))
    await opened.user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(markdown(opened)).toBe('Read the docs now.\n')
  })

  it('shows an address it would not follow as text, never as a link', () => {
    const opened = open('Read [the docs](vbscript:x) now.\n')
    select(opened, 'the docs', 3)
    expect(within(toolbar()).queryByRole('link')).toBeNull()
    expect(within(toolbar()).getByText('vbscript:x')).toBeVisible()
  })
})

describe('moving through the toolbar from the keyboard', () => {
  it('enters with Alt+F10, moves with the arrows, and leaves with Escape', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await opened.user.keyboard('{Alt>}{F10}{/Alt}')
    const bar = toolbar()
    const [first, second] = within(bar).getAllByRole('button')
    expect(first).toHaveFocus()
    await opened.user.keyboard('{ArrowRight}')
    expect(second).toHaveFocus()
    await opened.user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(within(bar).getAllByRole('button').at(-1)).toHaveFocus()
    await opened.user.keyboard('{Home}')
    expect(first).toHaveFocus()
    await opened.user.keyboard('{End}')
    expect(within(bar).getAllByRole('button').at(-1)).toHaveFocus()
    await opened.user.keyboard('{Escape}')
    expect(editorOf(opened).isFocused).toBe(true)
  })

  it('stays up while focus is inside it, and goes when focus goes elsewhere', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await opened.user.keyboard('{Alt>}{F10}{/Alt}')
    expect(toolbar()).toBeVisible()
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    act(() => {
      elsewhere.focus()
    })
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    elsewhere.remove()
  })

  it('leaves Alt+F10 alone when there is no toolbar to go to', async () => {
    const opened = open('Say something clever.\n')
    await opened.user.click(screen.getByRole('textbox', { name: 'Document' }))
    await opened.user.keyboard('{Alt>}{F10}{/Alt}')
    expect(screen.getByRole('textbox', { name: 'Document' })).toHaveFocus()
  })
})

describe('the toolbar over a callout', () => {
  const source = 'Before.\n\n:::callout{type=warning}\nMind the gap.\n:::\n'

  it('shows the callout’s type, and offers every variant', async () => {
    const opened = open(source)
    select(opened, 'Mind', 1)
    const bar = toolbar('Callout')
    await opened.user.click(within(bar).getByRole('button', { name: /Warning/ }))
    const menu = screen.getByRole('menu', { name: 'Callout type options' })
    const variants = within(menu).getAllByRole('menuitemradio')
    expect(variants.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Note'),
      expect.stringContaining('Info'),
      expect.stringContaining('Tip'),
      expect.stringContaining('Important'),
      expect.stringContaining('Warning'),
      expect.stringContaining('Caution'),
    ])
    expect(within(menu).getByRole('menuitemradio', { name: /Warning/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('changes the variant in place, restyling the callout and keeping its text', async () => {
    const opened = open(source)
    select(opened, 'Mind', 1)
    await opened.user.click(within(toolbar()).getByRole('button', { name: /Warning/ }))
    await opened.user.click(screen.getByRole('menuitemradio', { name: /Tip/ }))
    expect(markdown(opened)).toBe('Before.\n\n:::callout{type="tip"}\nMind the gap.\n:::\n')
    const callout = screen.getByRole('group', { name: 'Callout: tip' })
    expect(callout).toHaveClass('callout', 'callout-tip')
    expect(callout).not.toHaveClass('callout-warning')
    expect(within(toolbar()).getByRole('button', { name: /Tip/ })).toBeVisible()
  })

  it('adds a title, which is written in the callout and typed over the type’s name', async () => {
    const opened = open(source)
    select(opened, 'Mind', 1)
    const title = within(toolbar('Callout')).getByRole('button', { name: 'Title' })
    expect(title).toHaveAttribute('aria-pressed', 'false')

    await opened.user.click(title)
    await opened.user.keyboard('Watch the gap')

    expect(markdown(opened)).toBe(
      'Before.\n\n:::callout[Watch the gap]{type=warning}\nMind the gap.\n:::\n',
    )
    expect(within(toolbar('Callout')).getByRole('button', { name: 'Title' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('removes the title, which leaves the body and the type', async () => {
    const opened = open('Before.\n\n:::callout[Heads up]{type=warning}\nMind the gap.\n:::\n')
    select(opened, 'Mind', 1)

    await opened.user.click(within(toolbar('Callout')).getByRole('button', { name: 'Title' }))

    expect(markdown(opened)).toBe('Before.\n\n:::callout{type=warning}\nMind the gap.\n:::\n')
  })

  it('is about the callout with the caret in its title, too', () => {
    const opened = open('Before.\n\n:::callout[Heads up]{type=warning}\nMind the gap.\n:::\n')
    select(opened, 'Heads', 2)

    expect(within(toolbar('Callout')).getByRole('button', { name: 'Title' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('removes the callout and keeps its text, or deletes both', async () => {
    const opened = open(source)
    select(opened, 'Mind', 1)
    await opened.user.click(within(toolbar()).getByRole('button', { name: /Remove/ }))
    await opened.user.click(screen.getByRole('menuitem', { name: /keep the text/ }))
    expect(markdown(opened)).toBe('Before.\n\nMind the gap.\n')
  })
})

describe('a menu button in the toolbar', () => {
  const callout = 'Before.\n\n:::callout{type=warning}\nMind the gap.\n:::\n'

  it('closes its menu when it is pressed again, instead of closing it and opening it afresh', async () => {
    const opened = open(callout)
    select(opened, 'Mind', 1)
    const variant = within(toolbar()).getByRole('button', { name: /Warning/ })
    await opened.user.click(variant)
    expect(screen.getByRole('menu')).toBeVisible()
    await opened.user.click(variant)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(variant).toHaveAttribute('aria-expanded', 'false')
  })

  it('goes back to the button that opened a menu on Escape', async () => {
    const opened = open(callout)
    select(opened, 'Mind', 1)
    const variant = within(toolbar()).getByRole('button', { name: /Warning/ })
    await opened.user.click(variant)
    expect(screen.getByRole('menu')).toHaveFocus()
    await opened.user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(variant).toHaveFocus()
  })

  it('does not open a link box for a callout, which has no text selected to link', async () => {
    const opened = open(callout)
    select(opened, 'Mind', 1)
    await opened.user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('textbox', { name: 'Link address' })).not.toBeInTheDocument()
    expect(toolbar('Callout')).toBeVisible()
  })

  it('is entered with Alt+F10 like any other toolbar', async () => {
    const opened = open(callout)
    select(opened, 'Mind', 1)
    await opened.user.keyboard('{Alt>}{F10}{/Alt}')
    expect(within(toolbar()).getByRole('button', { name: /Warning/ })).toHaveFocus()
  })
})

describe('when there is nothing to hang from, or nothing to edit', () => {
  it('names plain text as the style of a block that is none of the known ones', () => {
    // The label of a leaf directive is inline text, in a block the style menu has no entry for.
    const opened = open('::documents[Recent]{limit=3}\n')
    select(opened, 'Recent')
    expect(within(toolbar('Text formatting')).getByRole('button', { name: /^Text/ })).toBeVisible()
  })

  it('does not appear over a document that cannot be edited', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(
      <DocumentEditor
        ast={parseDocument('Say something clever.\n').ast}
        ref={ref}
        editable={false}
      />,
    )
    const editor = ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
    act(() => {
      editor.view.focus()
      editor.chain().setTextSelection({ from: 5, to: 10 }).run()
    })
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('stays put when the browser has drawn nothing for the block it hangs from', () => {
    const opened = open('Before.\n\n:::callout{type=warning}\nMind the gap.\n:::\n')
    vi.spyOn(editorOf(opened).view, 'nodeDOM').mockReturnValue(null)
    select(opened, 'Mind', 1)
    expect(toolbar('Callout')).toBeVisible()
    expect(toolbar('Callout').style.top).toBe('')
  })
})
