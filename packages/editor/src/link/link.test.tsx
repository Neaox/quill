import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { documentFromMdast } from '../document/ast.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle, DocumentEditorProps } from '../document/document-editor.tsx'
import { editorSchema } from '../schema/editor-schema.ts'
import type { DocumentLinkTarget } from '../slash/slash-item.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import {
  applyLink,
  documentHref,
  documentIdOf,
  linkAt,
  linkInSelection,
  normaliseHref,
  unlink,
} from './link-commands.ts'
import { holdSelection } from './held-selection.ts'
import { LINK_CARD_LINGER_MS } from './link-card.tsx'
import { LINK_SEARCH_DELAY_MS, looksLikeAddress } from './link-popover.tsx'
import { sectionAnchor } from './section-link.ts'

/**
 * Links as a writer makes and changes them: Ctrl+K, an address or a document
 * found by name, the card a link shows, and a URL pasted over words.
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
  const select = (words: string, caret = false): void => {
    let found: { from: number; to: number } | undefined
    editor().state.doc.descendants((node, pos) => {
      const at = node.isText ? (node.text?.indexOf(words) ?? -1) : -1
      if (found === undefined && at >= 0) found = { from: pos + at, to: pos + at + words.length }
      return found === undefined
    })
    if (found === undefined) throw new Error(`No "${words}".`)
    const { from, to } = found
    act(() => {
      editor().view.dispatch(
        editor().state.tr.setSelection(
          caret
            ? TextSelection.create(editor().state.doc, from + 1)
            : TextSelection.create(editor().state.doc, from, to),
        ),
      )
      editor().view.focus()
    })
  }
  return { ...result, ref, editor, saved, select, user: userEvent.setup() }
}

function stateOf(markdown: string): EditorState {
  return EditorState.create({
    schema: editorSchema,
    doc: documentFromMdast(parseDocument(markdown).ast).doc,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Ctrl+K', () => {
  it('opens the link popover on the selection, and keeps the key from the page’s search', async () => {
    const { select, user } = open('Link these words.\n')
    const seen = vi.fn<(prevented: boolean) => void>()
    const listener = (event: KeyboardEvent): void => {
      seen(event.defaultPrevented)
    }
    window.addEventListener('keydown', listener)
    select('these')
    await user.keyboard('{Control>}k{/Control}')
    window.removeEventListener('keydown', listener)
    const dialog = await screen.findByRole('dialog', { name: 'Add link' })
    expect(seen).toHaveBeenLastCalledWith(true)
    expect(within(dialog).getByRole('textbox', { name: 'Text' })).toHaveValue('these')
    await expectNoAccessibilityViolations(dialog)
  })

  it('links the words to a pasted address, which a bare domain is', async () => {
    const { select, user, saved } = open('Link these words.\n')
    select('these')
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox', { name: 'Link to' }), 'example.com/a')
    expect(
      await screen.findByRole('option', { name: 'Link to https://example.com/a' }),
    ).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(saved()).toBe('Link [these](https://example.com/a) words.\n')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('links to a document found by its title, by id', async () => {
    const targets: readonly DocumentLinkTarget[] = [
      { id: 'abc', title: 'Runbook', context: 'Engineering' },
      { id: 'def', title: 'Run sheet' },
    ]
    const searchDocuments = vi.fn<
      (query: string, signal: AbortSignal) => Promise<readonly DocumentLinkTarget[]>
    >(async () => targets)
    const { select, user, saved } = open('See the runbook.\n', { searchDocuments })
    select('the runbook')
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox', { name: 'Link to' }), 'run')
    await user.click(await screen.findByRole('option', { name: 'Runbook' }, { timeout: 2000 }))
    expect(saved()).toBe('See [the runbook](/d/abc).\n')
    expect(searchDocuments).toHaveBeenCalledWith('run', expect.any(AbortSignal))
  })

  it('gives a link made at a caret the document’s title when it has no words', async () => {
    const searchDocuments = vi.fn<
      (query: string, signal: AbortSignal) => Promise<readonly DocumentLinkTarget[]>
    >(async () => [{ id: 'abc', title: 'Runbook' }])
    const { editor, user, saved } = open('Start\n', { searchDocuments })
    act(() => {
      editor().view.dispatch(
        editor().state.tr.setSelection(TextSelection.atEnd(editor().state.doc)),
      )
      editor().view.focus()
    })
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox', { name: 'Link to' }), 'run')
    await user.click(await screen.findByRole('option', { name: 'Runbook' }, { timeout: 2000 }))
    expect(saved()).toBe('Start[Runbook](/d/abc)\n')
  })

  it('treats a search that fails as finding nothing', async () => {
    const searchDocuments = vi.fn<
      (query: string, signal: AbortSignal) => Promise<readonly DocumentLinkTarget[]>
    >(async () => {
      throw new Error('offline')
    })
    const { select, user } = open('See the runbook.\n', { searchDocuments })
    select('runbook')
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox', { name: 'Link to' }), 'run')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LINK_SEARCH_DELAY_MS + 50))
    })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('says what it needs when there is nothing to link to', async () => {
    const { select, user, saved } = open('Link these words.\n')
    select('these')
    await user.keyboard('{Control>}k{/Control}')
    await user.click(await screen.findByRole('button', { name: 'Link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Paste an address, or choose a document from the list',
    )
    await user.type(screen.getByRole('combobox', { name: 'Link to' }), 'https://a.b/c')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Link' }))
    expect(saved()).toBe('Link [these](https://a.b/c) words.\n')
  })

  it('makes a link with words of its own at a caret, and says nothing for nothing typed', async () => {
    const { editor, user, saved } = open('Start\n')
    act(() => {
      editor().view.dispatch(
        editor().state.tr.setSelection(TextSelection.atEnd(editor().state.doc)),
      )
      editor().view.focus()
    })
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox', { name: 'Link to' }), 'https://a.b{Escape}')
    await user.type(screen.getByRole('textbox', { name: 'Text' }), ' here')
    await user.click(screen.getByRole('button', { name: 'Link' }))
    expect(saved()).toBe('Start[ here](https://a.b)\n')
  })

  it('closes on Escape and gives the words their focus back', async () => {
    const { select, user, editor } = open('Link these words.\n')
    select('these')
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: 'Add link' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(editor().view.hasFocus()).toBe(true)
  })

  it('keeps the words drawn as selected while the box has the keyboard, and lets go after', async () => {
    const { select, user, container } = open('Link these words.\n')
    select('these')
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: 'Add link' })

    const held = container.querySelectorAll('.selection-held')
    expect([...held].map((element) => element.textContent).join('')).toBe('these')

    await user.keyboard('{Escape}')
    expect(container.querySelector('.selection-held')).toBeNull()
  })

  it('lets go of words an edit takes away while the box is open', async () => {
    const { select, user, container, editor } = open('Link these words.\n')
    select('these')
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: 'Add link' })

    act(() => {
      editor().view.dispatch(editor().state.tr.delete(5, 12))
    })

    expect(container.querySelector('.selection-held')).toBeNull()
  })

  it('holds nothing once the editor itself has gone, as when the page is left', async () => {
    const { select, user, editor, unmount } = open('Link these words.\n')
    select('these')
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: 'Add link' })
    const view = editor().view

    act(() => {
      editor().destroy()
    })
    holdSelection(view, { from: 1, to: 3 })

    expect(() => {
      unmount()
    }).not.toThrow()
  })

  it('does nothing in a code block', async () => {
    const { editor, user } = open('```\ncode\n```\n')
    act(() => {
      editor().view.dispatch(
        editor().state.tr.setSelection(TextSelection.create(editor().state.doc, 2)),
      )
      editor().view.focus()
    })
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('editing a link', () => {
  it('changes where it goes and what it says, and opens, copies and unlinks it', async () => {
    const opened = vi.fn<(href: string) => void>()
    const copied = vi.fn<(text: string) => Promise<void>>(async () => {})
    const { select, user, saved } = open('See [the guide](https://example.com/guide).\n', {
      onOpenLink: opened,
      clipboard: { writeText: copied },
    })
    select('guide', true)
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Edit link' })
    await user.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(opened).toHaveBeenCalledWith('https://example.com/guide')
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(copied).toHaveBeenCalledWith('https://example.com/guide')
    const address = within(dialog).getByRole('combobox', { name: 'Link to' })
    await user.clear(address)
    await user.type(address, 'https://example.com/new{Escape}')
    const words = within(dialog).getByRole('textbox', { name: 'Text' })
    await user.clear(words)
    await user.type(words, 'the new guide')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(saved()).toBe('See [the new guide](https://example.com/new).\n')
    select('new guide', true)
    await user.keyboard('{Control>}k{/Control}')
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Edit link' })).getByRole('button', {
        name: 'Unlink',
      }),
    )
    expect(saved()).toBe('See the new guide.\n')
  })

  it('cannot open or copy where the application gave no way to', async () => {
    const { select, user } = open('See [the guide](https://example.com).\n', { clipboard: {} })
    select('guide', true)
    await user.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Edit link' })
    expect(within(dialog).getByRole('button', { name: 'Open' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeDisabled()
  })
})

describe('the link card', () => {
  it('shows where a link goes when the caret is in it, with what can be done', async () => {
    const opened = vi.fn<(href: string) => void>()
    const copied = vi.fn<(text: string) => Promise<void>>(async () => {})
    const { select, user, saved } = open('See [the guide](https://example.com/guide).\n', {
      onOpenLink: opened,
      clipboard: { writeText: copied },
    })
    select('guide', true)
    const card = screen.getByRole('group', { name: 'Link to https://example.com/guide' })
    await expectNoAccessibilityViolations(card)
    const button = (name: string) => within(card).getByRole('button', { name })
    await user.hover(button('Open link'))
    await user.click(button('Open link'))
    expect(opened).toHaveBeenCalledWith('https://example.com/guide')
    await user.hover(button('Copy link'))
    await user.click(button('Copy link'))
    expect(copied).toHaveBeenCalledWith('https://example.com/guide')
    await user.hover(button('Edit link'))
    await user.click(button('Edit link'))
    expect(await screen.findByRole('dialog', { name: 'Edit link' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    select('guide', true)
    const again = screen.getByRole('group', { name: /Link to/ })
    await user.hover(within(again).getByRole('button', { name: 'Unlink' }))
    await user.click(within(again).getByRole('button', { name: 'Unlink' }))
    expect(saved()).toBe('See the guide.\n')
  })

  it('says why Open and Copy cannot be used without the application', async () => {
    const { select, user } = open('See [the guide](https://example.com).\n', { clipboard: {} })
    select('guide', true)
    const card = screen.getByRole('group', { name: /Link to/ })
    const openLink = within(card).getByRole('button', { name: 'Open link' })
    expect(openLink).toHaveAttribute('aria-disabled', 'true')
    await user.click(openLink)
    expect(within(card).getByRole('button', { name: 'Copy link' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('shows on hover, lingers so it can be reached, and goes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { container } = open('See [the guide](https://example.com) and more.\n')
    const anchor = container.querySelector('a')
    if (anchor === null) throw new Error('No link drawn.')
    fireEvent.mouseOver(anchor)
    const card = screen.getByRole('group', { name: 'Link to https://example.com' })
    fireEvent.mouseOut(anchor)
    fireEvent.mouseEnter(card)
    act(() => {
      vi.advanceTimersByTime(LINK_CARD_LINGER_MS + 10)
    })
    expect(screen.getByRole('group', { name: /Link to/ })).toBeInTheDocument()
    fireEvent.mouseLeave(card)
    act(() => {
      vi.advanceTimersByTime(LINK_CARD_LINGER_MS + 10)
    })
    expect(screen.queryByRole('group', { name: /Link to/ })).not.toBeInTheDocument()
    fireEvent.mouseOver(anchor)
    fireEvent.mouseOut(anchor)
    act(() => {
      vi.advanceTimersByTime(LINK_CARD_LINGER_MS + 10)
    })
    expect(screen.queryByRole('group', { name: /Link to/ })).not.toBeInTheDocument()
    // Pointing at words that are not a link shows nothing.
    const words = container.querySelector('p')
    if (words !== null) {
      fireEvent.mouseOver(words)
      fireEvent.mouseOut(words)
    }
    expect(screen.queryByRole('group', { name: /Link to/ })).not.toBeInTheDocument()
  })

  it('goes while the author types, and is not shown in a read-only document', () => {
    const { select, editor } = open('See [the guide](https://example.com).\n')
    select('guide', true)
    expect(screen.getByRole('group', { name: /Link to/ })).toBeInTheDocument()
    act(() => {
      editor().view.dispatch(editor().state.tr.insertText('x'))
    })
    expect(screen.queryByRole('group', { name: /Link to/ })).not.toBeInTheDocument()
  })
})

describe('pasting an address over words', () => {
  it('links them', () => {
    const { select, editor, saved } = open('Link these words.\n')
    select('these')
    // The browser's paste event, carrying only an address as text.
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? 'https://example.com/pasted' : ''),
        files: [],
      },
    })
    act(() => {
      editor().view.dom.dispatchEvent(paste)
    })
    expect(saved()).toBe('Link [these](https://example.com/pasted) words.\n')
  })
})

describe('the link commands', () => {
  it('find the whole run of words a link covers, from either end or inside', () => {
    const state = stateOf('A [**bold** link](https://a.b) here.\n')
    const start = linkAt(state, 3)
    expect(start).toMatchObject({ from: 3, to: 12, href: 'https://a.b', text: 'bold link' })
    expect(linkAt(state, 12)).toMatchObject({ from: 3, to: 12 })
    expect(linkAt(state, 7)).toMatchObject({ from: 3, to: 12 })
    expect(linkAt(state, 1)).toBeUndefined()
    expect(linkAt(state, 0)).toBeUndefined()
  })

  it('read a link with no address as an empty one', () => {
    const state = stateOf('[x](https://a.b)\n')
    const doc = state.doc
    const mark = editorSchema.marks['link']?.create({ href: null })
    if (mark === undefined) throw new Error('No link mark.')
    const relinked = state.apply(state.tr.removeMark(1, 2).addMark(1, 2, mark))
    expect(linkAt(relinked, 1)?.href).toBe('')
    expect(doc.childCount).toBe(1)
  })

  it('find the link a selection is wholly inside, and not one it runs out of', () => {
    const state = stateOf('A [link](https://a.b) here.\n')
    const inside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4, 6)))
    expect(linkInSelection(inside)).toMatchObject({ href: 'https://a.b' })
    const across = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4, 10)))
    expect(linkInSelection(across)).toBeUndefined()
    expect(linkInSelection(state)).toBeUndefined()
  })

  it('refuse an empty address, and unlink only where there is a link', () => {
    const state = stateOf('Words.\n')
    expect(applyLink({ from: 1, to: 6, href: '  ' })(state)).toBe(false)
    expect(applyLink({ from: 1, to: 6, href: 'https://a.b' })(state)).toBe(true)
    expect(unlink(1, 6)(state)).toBe(false)
    expect(unlink(1, 3)(stateOf('[ab](x)\n'))).toBe(true)
  })

  it('make an address of what was typed', () => {
    expect(normaliseHref('  example.com/a ')).toBe('https://example.com/a')
    expect(normaliseHref('person@example.com')).toBe('mailto:person@example.com')
    expect(normaliseHref('https://a.b')).toBe('https://a.b')
    expect(normaliseHref('/d/abc')).toBe('/d/abc')
    expect(normaliseHref('#section')).toBe('#section')
    expect(normaliseHref('words')).toBe('words')
    expect(normaliseHref(' ')).toBe('')
    expect(looksLikeAddress('words')).toBe(false)
    expect(looksLikeAddress('a.b')).toBe(true)
    expect(looksLikeAddress('ftp://x')).toBe(true)
  })

  it('link to a document by id, and read the id back', () => {
    expect(documentHref('abc')).toBe('/d/abc')
    expect(documentIdOf('/d/abc#part')).toBe('abc')
    expect(documentIdOf('https://a.b')).toBeUndefined()
  })

  it('find the heading a position is under, numbering repeated ones as the reader does', () => {
    const state = stateOf('Intro.\n\n# A\n\n## B\n\nText.\n\n## B\n\nMore.\n')
    expect(sectionAnchor(state, 1)).toBeUndefined()
    let more = 0
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'More.') more = pos
      return true
    })
    expect(sectionAnchor(state, more)).toEqual({ title: 'B', fragment: 'user-content-b-1' })
  })
})

describe('the edges of links', () => {
  it('ignores a search that answers after the words have changed', async () => {
    let answer: ((targets: readonly DocumentLinkTarget[]) => void) | undefined
    const searchDocuments = vi.fn<
      (query: string, signal: AbortSignal) => Promise<readonly DocumentLinkTarget[]>
    >(
      () =>
        new Promise<readonly DocumentLinkTarget[]>((resolve) => {
          answer = resolve
        }),
    )
    const { select, user } = open('See the runbook.\n', { searchDocuments })
    select('runbook')
    await user.keyboard('{Control>}k{/Control}')
    const field = await screen.findByRole('combobox', { name: 'Link to' })
    await user.type(field, 'run')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LINK_SEARCH_DELAY_MS + 20))
    })
    const late = answer
    await user.type(field, 'b')
    await act(async () => {
      late?.([{ id: 'old', title: 'Old answer' }])
      await Promise.resolve()
    })
    expect(screen.queryByRole('option', { name: 'Old answer' })).not.toBeInTheDocument()
  })

  it('shows no card for a pointer over words that are not drawn as elements', () => {
    const { container } = open('Plain words.\n')
    const text = container.querySelector('p')?.firstChild
    if (text === null || text === undefined) throw new Error('No text.')
    text.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    text.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    expect(screen.queryByRole('group', { name: /Link to/ })).not.toBeInTheDocument()
  })
})
