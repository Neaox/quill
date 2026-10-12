import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { EditorState } from '@tiptap/pm/state'

import { documentFromMdast } from '../document/ast.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle, DocumentEditorProps } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import type { DocumentLinkTarget, SlashContribution, SlashRequest } from './slash-item.ts'
import { SlashMenu } from './slash-menu.tsx'
import { SEARCH_DELAY_MS } from './slash-picker.tsx'
import { createSlashRegistry } from './slash-registry.ts'
import { slashSections } from './slash-sections.ts'
import { createSlashStore } from './slash-store.ts'
import { editorSchema } from '../schema/editor-schema.ts'

/**
 * The slash menu as an author meets it: the real editor, a real keyboard,
 * and the Markdown that comes out the other side.
 */

type Extra = Partial<Omit<DocumentEditorProps, 'ast' | 'ref'>>

function open(source = 'Start here.\n', extra: Extra = {}) {
  localStorage.clear()
  const ref = createRef<DocumentEditorHandle>()
  const onRequest = vi.fn<(request: SlashRequest) => void>()
  const result = render(
    <DocumentEditor ast={parseDocument(source).ast} ref={ref} onRequest={onRequest} {...extra} />,
  )
  return { ref, onRequest, user: userEvent.setup(), ...result }
}

function editorOf(ref: { current: DocumentEditorHandle | null }) {
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  return editor
}

function markdown(ref: { current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

function surface(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Document' })
}

function menu(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Insert a block' })
}

function menuIsOpen(): boolean {
  return screen.queryByRole('listbox', { name: 'Insert a block' }) !== null
}

function optionNames(): readonly string[] {
  return screen
    .queryAllByRole('option')
    .map((option) => option.querySelector('.truncate')?.textContent ?? '')
}

/** Clicks into the document and puts the caret at a position, the end by default. */
async function caretAt(
  user: ReturnType<typeof userEvent.setup>,
  ref: { current: DocumentEditorHandle | null },
  position: 'start' | 'end' | number = 'end',
): Promise<void> {
  await user.click(surface())
  act(() => {
    editorOf(ref).commands.focus(position)
  })
}

/**
 * Deletes characters before the caret, as Backspace does natively. jsdom
 * has no editing behaviour of its own, so a Backspace keypress there deletes
 * nothing; the transaction is what the browser's deletion becomes.
 */
function backspace(ref: { current: DocumentEditorHandle | null }, count = 1): void {
  const editor = editorOf(ref)
  act(() => {
    const { from } = editor.state.selection
    editor.view.dispatch(editor.state.tr.delete(from - count, from))
  })
}

/** Scrolls the menu to its last row, as a wheel or a finger would. */
function scrollToEnd(): void {
  const list = menu()
  list.scrollTop = 100_000
  fireEvent.scroll(list)
}

/** Removes every editor this test rendered, for a test that opens a second. */
function unmountAll(): void {
  cleanup()
}

async function slash(
  user: ReturnType<typeof userEvent.setup>,
  ref: { current: DocumentEditorHandle | null },
  query = '',
  position: 'start' | 'end' | number = 'start',
): Promise<void> {
  await caretAt(user, ref, position)
  await user.keyboard(`/${query}`)
}

describe('opening the slash menu', () => {
  it('opens on a slash at the start of a line, grouped, and passes axe', async () => {
    const { user, ref, container } = open()
    await slash(user, ref)
    expect(menu()).toBeVisible()
    expect(within(menu()).getByRole('group', { name: 'Text' })).toBeVisible()
    expect(within(menu()).getByRole('group', { name: 'Blocks' })).toBeVisible()
    // Only the rows in view are drawn; scrolling draws the rest.
    expect(within(menu()).queryByRole('group', { name: 'Templates' })).toBeNull()
    scrollToEnd()
    expect(within(menu()).getByRole('group', { name: 'Templates' })).toBeVisible()
    await expectNoAccessibilityViolations(container)
  })

  it('opens after a space, but not inside a word', async () => {
    const { user, ref } = open('and/or\n')
    await caretAt(user, ref, 4)
    expect(menuIsOpen()).toBe(false)
    await user.keyboard('x /')
    expect(menuIsOpen()).toBe(true)
  })

  it('does not open inside a web address or inline code', async () => {
    const { user, ref } = open('See https:/ here.\n')
    // Between the colon and the slash already there.
    await caretAt(user, ref, 11)
    await user.keyboard('/')
    expect(menuIsOpen()).toBe(false)
    unmountAll()

    const code = open('Run `a` now.\n')
    // Inside the inline code, after its letter.
    await caretAt(code.user, code.ref, 6)
    await code.user.keyboard(' /')
    expect(menuIsOpen()).toBe(false)
  })

  it('does not open inside a code block', async () => {
    const { user, ref } = open('```\ncode\n```\n')
    await caretAt(user, ref, 2)
    await user.keyboard(' /')
    expect(menuIsOpen()).toBe(false)
  })

  it('opens inside a list item and a callout, offering what they can hold', async () => {
    const { user, ref } = open('- one\n- \n')
    await slash(user, ref, '', 'end')
    expect(menuIsOpen()).toBe(true)
    // A list item opens with a paragraph, so it cannot be turned into a heading.
    expect(optionNames()).not.toContain('Heading 1')
    await user.keyboard('tab')
    expect(optionNames()).toContain('Table')
    unmountAll()

    const callout = open(':::callout{type="note"}\nInside.\n:::\n')
    await slash(callout.user, callout.ref, 'quote', 2)
    await callout.user.keyboard('{Enter}')
    expect(markdown(callout.ref)).toContain('> Inside.')
  })

  it('in a table cell offers only what a cell can hold', async () => {
    const { user, ref } = open('| A | B |\n| - | - |\n| 1 | 2 |\n')
    await slash(user, ref, '', 4)
    expect(optionNames()).toContain('Status badge')
    expect(optionNames()).not.toContain('Table')
    expect(optionNames()).not.toContain('Heading 1')
  })

  it('names the list and the active option on the document, which keeps the focus', async () => {
    const { user, ref } = open()
    await slash(user, ref)
    const [first] = within(menu()).getAllByRole('option')
    expect(surface()).toHaveAttribute('aria-activedescendant', first?.id)
    expect(surface()).toHaveAttribute('aria-controls', menu().id)
    expect(surface()).toHaveFocus()
  })

  it('announces how many blocks match, politely', async () => {
    const { user, ref } = open()
    await slash(user, ref, 'heading')
    expect(screen.getByRole('status')).toHaveTextContent('4 blocks')
    backspace(ref, 7)
    await user.keyboard('divider')
    expect(screen.getByRole('status')).toHaveTextContent('1 block')
  })
})

describe('filtering and ranking', () => {
  it('puts a label that starts with the query first and marks what matched', async () => {
    const { user, ref } = open()
    await slash(user, ref, 'tab')
    expect(optionNames()[0]).toBe('Table')
    const [first] = within(menu()).getAllByRole('option')
    expect(first?.querySelector('mark')).toHaveTextContent('Tab')
  })

  it('finds an item by its alias, its words, and its keywords', async () => {
    const { user, ref } = open()
    await slash(user, ref, 'h2')
    expect(optionNames()[0]).toBe('Heading 2')
    backspace(ref, 2)
    await user.keyboard('call warn')
    expect(optionNames()[0]).toBe('Callout: Warning')
  })

  it('says when nothing matches, in the words the author typed', async () => {
    const { user, ref } = open()
    await slash(user, ref, 'zzz')
    expect(screen.getByText('No blocks match “zzz”')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('No blocks')
  })

  it('shows the Markdown shortcut beside an item, as a key', async () => {
    const { user, ref } = open()
    await slash(user, ref, 'heading 2')
    const [first] = within(menu()).getAllByRole('option')
    expect(first?.querySelector('kbd')).toHaveTextContent('##')
  })
})

describe('the keyboard', () => {
  it('moves with the arrows, wrapping at both ends', async () => {
    const { user, ref } = open()
    await slash(user, ref, 'heading')
    const options = within(menu()).getAllByRole('option')
    await user.keyboard('{ArrowUp}')
    expect(options.at(-1)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('scrolls the list to the option the arrows reach, and back', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref)
    const list = menu()
    await user.keyboard('{ArrowUp}')
    expect(list.scrollTop).toBeGreaterThan(0)
    expect(surface().getAttribute('aria-activedescendant')).not.toBeNull()
    expect(
      document.getElementById(surface().getAttribute('aria-activedescendant') ?? ''),
    ).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(list.scrollTop).toBe(0)
  })

  it('keeps the list’s space above and below its rows inside the scroller, never as its padding', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref)
    const list = menu()
    // A box cannot be shorter than its padding. With the catalogue's worth of
    // space as padding on the scroller, the scroller was as tall as the whole
    // catalogue, the menu clipped it, and the last blocks could not be reached.
    expect(list.getAttribute('style')).toBeNull()
    const spacer = list.firstElementChild
    expect(spacer).toHaveStyle({ paddingTop: '4px' })
    expect(spacer?.getAttribute('style')).toMatch(/padding-bottom: [0-9]+px/)
  })

  it('gives every row its height in rem, so the sums the list is windowed by are the real heights', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref)
    for (const option of screen.getAllByRole('option')) {
      expect(option.style.height).toBe('2.75rem')
    }
    const drawn = within(menu())
      .getAllByRole('presentation')
      // A heading scrolled out of the window is only a name, and takes no space.
      .filter((heading) => !heading.hasAttribute('data-offscreen'))
    for (const heading of drawn) expect(heading.style.height).toBe('1.75rem')
  })

  it('inserts with Enter, and with Tab', async () => {
    const enter = open('\n')
    await slash(enter.user, enter.ref, 'h2')
    await enter.user.keyboard('{Enter}Title')
    expect(markdown(enter.ref)).toBe('## Title\n')
    enter.unmount()

    const tab = open('\n')
    await slash(tab.user, tab.ref, 'quote')
    await tab.user.keyboard('{Tab}Said')
    expect(markdown(tab.ref)).toBe('> Said\n')
  })

  it('closes on Escape and leaves what was typed as text, even as typing goes on', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'table')
    await user.keyboard('{Escape}')
    expect(menuIsOpen()).toBe(false)
    expect(surface()).not.toHaveAttribute('aria-activedescendant')
    await user.keyboard('s')
    expect(menuIsOpen()).toBe(false)
    expect(markdown(ref)).toBe('/tables\n')
  })

  it('closes when a space follows a query nothing matches, and on a space straight after the slash', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'zzz')
    expect(menuIsOpen()).toBe(false)
    await user.keyboard(' ')
    expect(menuIsOpen()).toBe(false)
    unmountAll()

    const spaced = open('\n')
    await slash(spaced.user, spaced.ref, ' ')
    expect(menuIsOpen()).toBe(false)
    expect(screen.queryByText(/No blocks match/)).toBeNull()
  })

  it('keeps going through a space when the words still match', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'heading 3')
    expect(optionNames()[0]).toBe('Heading 3')
  })

  it('closes when the slash is deleted', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'ta')
    backspace(ref, 2)
    expect(menuIsOpen()).toBe(true)
    backspace(ref)
    expect(menuIsOpen()).toBe(false)
  })

  it('leaves Enter to the document when nothing matches', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'qqq')
    await user.keyboard('{Enter}')
    expect(menuIsOpen()).toBe(false)
    expect(markdown(ref)).toMatch(/^\/qqq\n/)
  })
})

describe('inserting', () => {
  it('replaces the empty line it was typed on, with the caret inside the new block', async () => {
    const { user, ref } = open('Before.\n\nAfter.\n')
    // An empty line between the two, made the way an author makes one.
    await caretAt(user, ref, 8)
    await user.keyboard('{Enter}/callout note{Enter}Noted')
    expect(editorOf(ref).state.doc.childCount).toBe(3)
    expect(markdown(ref)).toBe('Before.\n\n> [!NOTE]\n> Noted\n\nAfter.\n')
  })

  it('puts a block after a line with words in it, removing only the query', async () => {
    const { user, ref } = open('Some words\n')
    await slash(user, ref, 'divider', 'end')
    expect(menuIsOpen()).toBe(false)
    backspace(ref, 8)
    await user.keyboard(' /divider{Enter}Next')
    expect(markdown(ref)).toBe('Some words\n\n---\n\nNext\n')
  })

  it('puts the caret in the first cell of a new table', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'table')
    await user.keyboard('{Enter}Name')
    expect(markdown(ref)).toMatch(/^\| Name \|/)
  })

  it('is undone in one step, which gives the query back', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'h1')
    await user.keyboard('{Enter}')
    expect(editorOf(ref).state.doc.child(0).type.name).toBe('heading')
    await user.keyboard('{Control>}z{/Control}')
    expect(markdown(ref)).toBe('/h1\n')
  })

  it('inserts what the pointer chooses, keeping the selection it acts on', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'guidance')
    await user.click(screen.getByRole('option', { name: /Guidance/ }))
    expect(markdown(ref)).toContain(':::guidance')
  })

  it('highlights the item the pointer moves over', async () => {
    const { user, ref } = open()
    await slash(user, ref, 'callout')
    const second = within(menu()).getAllByRole('option')[1]
    if (second === undefined) throw new Error('There is only one callout.')
    await user.hover(second)
    expect(second).toHaveAttribute('data-active')
  })

  it('raises a request for what only the application can supply', async () => {
    const { user, ref, onRequest } = open('\n')
    await slash(user, ref, 'image')
    await user.keyboard('{Enter}')
    expect(onRequest).toHaveBeenCalledWith({ kind: 'image' })
    await slash(user, ref, 'svg')
    await user.keyboard('{Enter}')
    expect(onRequest).toHaveBeenCalledWith({ kind: 'drawing' })
    expect(markdown(ref)).toBe('')
  })

  it('adds a contribution’s items after Quill’s own', async () => {
    const contribution: SlashContribution = {
      id: 'acme.decision',
      items: () => [
        {
          id: 'decision',
          label: 'Decision',
          description: 'A decision record',
          group: 'Acme',
          keywords: [],
          icon: () => null,
          run: ({ state, dispatch }) => {
            dispatch(state.tr.insertText('Decided.'))
          },
        },
      ],
    }
    const { user, ref } = open('\n', { slashContributions: [contribution] })
    await slash(user, ref)
    scrollToEnd()
    expect(within(menu()).getByRole('group', { name: 'Acme' })).toBeVisible()
    await user.keyboard('decision{Enter}')
    expect(markdown(ref)).toBe('Decided.\n')
  })
})

describe('what stands before an item', () => {
  it('is its icon, an emoji’s character or its picture, or nothing for an item that has none', async () => {
    const contribution: SlashContribution = {
      id: 'acme.marks',
      items: () =>
        [
          { id: 'plain', label: 'Plain mark' },
          { id: 'glyph', label: 'Glyph mark', glyph: '🎉' },
          { id: 'picture', label: 'Picture mark', image: '/api/emoji/a.0123456789abcdef.svg' },
        ].map((item) => ({
          description: 'Marked',
          group: 'Marks',
          keywords: ['mark'],
          run: () => undefined,
          ...item,
        })),
    }
    const { user, ref } = open('\n', { slashContributions: [contribution] })
    await slash(user, ref, 'mark')

    const marks = within(menu())
      .getAllByRole('option')
      .map((option) => option.firstElementChild)
    expect(marks.map((mark) => mark?.childElementCount)).toEqual([0, 1, 1])
    expect(menu().querySelector('[aria-hidden="true"]')).toHaveTextContent('🎉')
    expect(menu().querySelector('img')).toHaveAttribute('alt', '')
  })
})

describe('recently used blocks', () => {
  it('come first when nothing is typed, remembered per key', async () => {
    const { user, ref } = open('\n\n', { recentsKey: 'editor.slash.recent.ada' })
    await slash(user, ref, 'divider')
    await user.keyboard('{Enter}')
    await slash(user, ref, '', 'end')
    const recent = within(menu()).getByRole('group', { name: 'Recently used' })
    expect(within(recent).getByRole('option', { name: /Divider/ })).toBeVisible()
    expect(localStorage.getItem('editor.slash.recent.ada')).toBe('["divider"]')
  })
})

describe('pickers', () => {
  it('asks for a code block’s language, filtering as the author types', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'code')
    await user.keyboard('{Enter}')
    const field = screen.getByRole('combobox', { name: 'Code block language' })
    expect(field).toHaveFocus()
    await user.keyboard('pyth{Enter}')
    expect(markdown(ref)).toBe('```python\n```\n')
  })

  it('leaves nothing behind when it is cancelled, by Escape, Backspace or leaving it', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'code')
    await user.keyboard('{Enter}{Escape}')
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(markdown(ref)).toBe('')
    expect(surface()).toHaveFocus()

    await slash(user, ref, 'badge')
    await user.keyboard('{Enter}{Backspace}')
    expect(screen.queryByRole('combobox')).toBeNull()

    await slash(user, ref, 'badge')
    await user.keyboard('{Enter}')
    await user.click(document.body)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(markdown(ref)).toBe('')
  })

  it('stays open while focus moves within it', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'badge')
    await user.keyboard('{Enter}')
    const field = screen.getByRole('combobox', { name: 'Badge tone' })
    const [first] = screen.getAllByRole('option')
    fireEvent.blur(field, { relatedTarget: first })
    expect(screen.getByRole('combobox', { name: 'Badge tone' })).toBeVisible()
  })

  it('finds GitHub’s emoji when the organisation has none of its own', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'emoji')
    await user.keyboard('{Enter}tada')
    expect(await screen.findByRole('option', { name: /Party popper/ })).toBeVisible()
  })

  it('inserts a badge in the tone chosen, with its words selected to type over', async () => {
    const { user, ref, container } = open('\n')
    await slash(user, ref, 'badge')
    await user.keyboard('{Enter}')
    await expectNoAccessibilityViolations(container)
    await user.click(screen.getByRole('option', { name: /Warning/ }))
    await user.keyboard('Partial')
    expect(markdown(ref)).toBe(':warn[Partial]\n')
  })

  it('says when no option matches', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'badge')
    await user.keyboard('{Enter}zzz')
    expect(screen.getByText('No tone matches “zzz”')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('No results')
  })

  it('offers the organisation’s labels, only when it has some', async () => {
    const without = open('\n')
    await slash(without.user, without.ref, 'label')
    expect(optionNames()).not.toContain('Label')
    without.unmount()

    const { user, ref } = open('\n', { labels: ['airbnb', 'booking'] })
    await slash(user, ref, 'label')
    await user.keyboard('{Enter}book{Enter}')
    expect(markdown(ref)).toBe(':booking[Booking]\n')
  })

  it('finds an emoji by name, the organisation’s own among them', async () => {
    const custom = new Map([
      ['acme', { src: '/api/emoji/acme.0123456789abcdef.png', width: 1, height: 1 }],
    ])
    const { user, ref } = open('\n', { emoji: { custom, labelEmoji: new Map() } })
    await slash(user, ref, 'emoji')
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('option', { name: /:acme:/ })).toBeVisible()
    await user.keyboard('tada')
    await screen.findByRole('option', { name: /Party popper/ })
    await user.keyboard('{Enter}')
    expect(markdown(ref)).toBe(':tada:\n')
  })

  it('links to a document by its id, found by the application’s search', async () => {
    const searchDocuments = vi.fn<(query: string) => Promise<readonly DocumentLinkTarget[]>>(
      async () => [{ id: 'doc-1', title: 'Runbook', context: 'Engineering' }],
    )
    const { user, ref } = open('\n', { searchDocuments })
    await slash(user, ref, 'link to')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Type to search documents')).toBeVisible()
    await user.keyboard('run')
    const option = await screen.findByRole('option', { name: /Runbook/ })
    expect(option).toHaveTextContent('Engineering')
    await user.keyboard('{Enter}')
    expect(markdown(ref)).toBe('[Runbook](/d/doc-1)\n')
    expect(searchDocuments).toHaveBeenCalledWith('run', expect.any(AbortSignal))
  })

  it('treats a search that fails as finding nothing', async () => {
    const searchDocuments = vi.fn<(query: string) => Promise<readonly DocumentLinkTarget[]>>(
      async () => Promise.reject(new Error('offline')),
    )
    const { user, ref } = open('\n', { searchDocuments })
    await slash(user, ref, 'link to')
    await user.keyboard('{Enter}run')
    expect(await screen.findByText('No document matches “run”')).toBeVisible()
  })

  it('does not offer a document link without a search to find documents with', async () => {
    const { user, ref } = open('\n')
    await slash(user, ref, 'link to')
    expect(optionNames()).not.toContain('Link to document')
  })

  it('waits for the author to stop typing before it searches', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const searchDocuments = vi.fn<(query: string) => Promise<readonly DocumentLinkTarget[]>>(
        async () => [],
      )
      const { user, ref } = open('\n', { searchDocuments })
      await slash(user, ref, 'link to')
      await user.keyboard('{Enter}a')
      await user.keyboard('b')
      act(() => {
        vi.advanceTimersByTime(SEARCH_DELAY_MS)
      })
      expect(searchDocuments).not.toHaveBeenCalledWith('a', expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a search that answers late', () => {
  it('is ignored once the author has typed on, whether it succeeds or fails', async () => {
    const pending = new Map<string, PromiseWithResolvers<readonly DocumentLinkTarget[]>>()
    const searchDocuments = vi.fn<(query: string) => Promise<readonly DocumentLinkTarget[]>>(
      (query: string) => {
        const deferred = Promise.withResolvers<readonly DocumentLinkTarget[]>()
        pending.set(query, deferred)
        return deferred.promise
      },
    )
    const { user, ref } = open('\n', { searchDocuments })
    await slash(user, ref, 'link to')
    await user.keyboard('{Enter}a')
    await vi.waitFor(() => {
      expect(pending.has('a')).toBe(true)
    })
    await user.keyboard('b')
    await vi.waitFor(() => {
      expect(pending.has('ab')).toBe(true)
    })
    await user.keyboard('c')
    await act(async () => {
      pending.get('a')?.resolve([{ id: 'stale', title: 'Stale' }])
      pending.get('ab')?.reject(new Error('Aborted'))
      await Promise.resolve()
    })
    expect(screen.queryByRole('option', { name: /Stale/ })).toBeNull()
    await vi.waitFor(() => {
      expect(pending.has('abc')).toBe(true)
    })
    await act(async () => {
      pending.get('abc')?.resolve([{ id: 'fresh', title: 'Fresh' }])
      await Promise.resolve()
    })
    expect(await screen.findByRole('option', { name: /Fresh/ })).toBeVisible()
  })

  it('finds nothing once the application stops offering a search', async () => {
    const { user, ref, rerender } = open('\n', { searchDocuments: async () => [] })
    rerender(<DocumentEditor ast={parseDocument('\n').ast} ref={ref} />)
    await slash(user, ref, 'link to')
    await user.keyboard('{Enter}run')
    expect(await screen.findByText('No document matches “run”')).toBeVisible()
  })
})

/** Enough contributed items to bring the catalogue to a hundred. */
function hundred(): SlashContribution {
  const count = 100 - createSlashRegistry().items.length
  return {
    id: 'test.many',
    items: () =>
      Array.from({ length: count }, (_, index) => ({
        id: `extra-${String(index)}`,
        label: `Extra block ${String(index)}`,
        description: 'One of many',
        group: 'Extras',
        keywords: ['extra'],
        icon: () => null,
        run: () => {},
      })),
  }
}

function median(samples: readonly number[]): number {
  const sorted = samples.toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY
}

describe('the frame budget (quill-plan.md section 31)', () => {
  /*
   * Counted rather than timed where jsdom is not the browser: jsdom builds DOM
   * an order of magnitude slower than a browser, and a parallel run adds noise
   * on top, so a timed render here measures the machine. What keeps the menu
   * inside a frame is how much it does, and that is counted: the catalogue
   * work per keystroke is timed as a median of many runs (it is pure and
   * cheap), and the rows drawn are counted — a dozen in view, however many
   * items there are.
   */
  it('works out a keystroke’s list in well under a frame with a hundred items', () => {
    const registry = createSlashRegistry({ contributions: [hundred()] })
    expect(registry.items).toHaveLength(100)
    const state = EditorState.create({
      schema: editorSchema,
      doc: documentFromMdast(parseDocument('Words\n').ast).doc,
    })
    const samples: number[] = []
    for (let run = 0; run < 25; run += 1) {
      // A fresh state each time, as each keystroke is, so nothing is cached.
      const typed = state.apply(state.tr)
      const started = performance.now()
      for (const query of ['', 'e', 'ex', 'ext']) {
        slashSections(query, registry.available(typed), [])
      }
      samples.push((performance.now() - started) / 4)
    }
    expect(median(samples)).toBeLessThan(16)
  })

  it('draws only the rows in view, however many items there are', () => {
    const registry = createSlashRegistry({ contributions: [hundred()] })
    const store = createSlashStore()
    render(<SlashMenu store={store} editor={null} />)
    act(() => {
      store.showMenu({
        query: '',
        sections: slashSections('', registry.items, []),
        rect: { top: 100, bottom: 120, left: 10 },
        apply: () => {},
      })
    })
    const drawn = screen.getAllByRole('option')
    // 384 pixels of 44-pixel rows is nine, and four either side to spare.
    expect(drawn.length).toBeLessThanOrEqual(13)
    expect(drawn[0]).toHaveAttribute('aria-setsize', '100')
    expect(drawn[0]).toHaveAttribute('aria-posinset', '1')
  })
})

describe('the menu on its own', () => {
  it('opens above a caret near the bottom of the window', () => {
    const store = createSlashStore()
    render(<SlashMenu store={store} editor={null} />)
    act(() => {
      store.showMenu({
        query: 'zz',
        sections: [],
        rect: { top: innerHeight - 20, bottom: innerHeight - 4, left: 10 },
        apply: () => {},
      })
    })
    const panel = screen.getByText('No blocks match “zz”').parentElement
    expect(panel).toHaveAttribute('data-side', 'above')
    expect(panel?.style.bottom).not.toBe('')
  })

  it('shows nothing while it is closed', () => {
    const store = createSlashStore()
    const { container } = render(<SlashMenu store={store} editor={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
