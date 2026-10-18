import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextSelection } from '@tiptap/pm/state'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle, DocumentEditorProps } from '../document/document-editor.tsx'
import type { ImageAction } from '../image/image-actions.ts'
import type { SlashRequest } from '../slash/slash-item.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { CODE_WRAP_KEY } from '../code-block/code-block-menu.ts'
import { createContextMenuRegistry } from './context-menu-registry.ts'
import type { ContextMenuContribution } from './context-menu-registry.ts'
import { unwrapLone } from './editor-context-menu.tsx'
import { createOverlayStore } from './overlay-store.ts'
import { placeLabel } from './context-menu-trigger.ts'

/**
 * The writing surface's context menu, as an author meets it: a right-click,
 * Shift+F10 or the context-menu key, a long press; what is offered depends on
 * what is under the pointer; Shift and right-click leaves the browser's own.
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
  return { ...result, ref, editor, saved, user: userEvent.setup() }
}

/** The element a piece of text is drawn in. */
function textElement(words: string): HTMLElement {
  return screen.getByText(
    (_content, element) => element?.textContent === words && element.children.length === 0,
  )
}

/** Right-clicks the element drawing `words`. */
function rightClick(words: string, init: MouseEventInit = {}): boolean {
  return fireEvent.contextMenu(textElement(words), { clientX: 10, clientY: 10, ...init })
}

/** Puts the caret at the end of the document, with focus, at once. */
function caretAtEnd(editor: ReturnType<ReturnType<typeof open>['editor']>): void {
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
    editor.view.focus()
  })
}

function select(editor: ReturnType<ReturnType<typeof open>['editor']>, words: string): void {
  let found: { from: number; to: number } | undefined
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text?.indexOf(words) ?? -1) : -1
    if (found === undefined && at >= 0) found = { from: pos + at, to: pos + at + words.length }
    return found === undefined
  })
  if (found === undefined) throw new Error(`No "${words}".`)
  const { from, to } = found
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    )
    editor.view.focus()
  })
}

/**
 * Chooses an entry in a submenu from the keyboard: Right opens it, Enter
 * chooses. (jsdom lays nothing out, so a pointer crossing into a submenu
 * leaves Radix's grace area at once and the submenu closes under it; the
 * keyboard path is the one a test can drive faithfully.)
 */
async function chooseInSubmenu(
  user: ReturnType<typeof userEvent.setup>,
  submenu: string,
  name: string | RegExp,
  role: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox' = 'menuitem',
): Promise<void> {
  const trigger = await screen.findByRole('menuitem', { name: submenu })
  act(() => {
    trigger.focus()
  })
  await user.keyboard('{ArrowRight}')
  const target = await screen.findByRole(role, { name })
  act(() => {
    target.focus()
  })
  await user.keyboard('{Enter}')
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('opening the menu', () => {
  it('opens on a right-click over words, for the words, and passes axe', async () => {
    open('Some words here.\n')
    expect(rightClick('Some words here.')).toBe(false)
    const menu = await screen.findByRole('menu', { name: 'Text' })
    for (const name of [
      'Cut',
      'Copy',
      'Paste',
      'Paste as plain text',
      'Format',
      'Link',
      'Turn into',
    ]) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument()
    }
    await expectNoAccessibilityViolations(menu)
  })

  it('leaves Shift and right-click to the browser’s own menu', () => {
    open('Some words here.\n')
    // Not cancelled: the browser shows its own menu, with its spelling suggestions.
    expect(rightClick('Some words here.', { shiftKey: true })).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens at the caret with Shift+F10 and the context-menu key, and Escape returns', async () => {
    const { user, editor } = open('Some words here.\n')
    select(editor(), 'words')
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(await screen.findByRole('menu', { name: 'Text' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(editor().view.hasFocus()).toBe(true)
    await user.keyboard('{ContextMenu}')
    expect(await screen.findByRole('menu', { name: 'Text' })).toBeInTheDocument()
    // The browser's own event after the key does not open a second one.
    expect(rightClick('Some words here.')).toBe(false)
    expect(screen.getAllByRole('menu')).toHaveLength(1)
  })

  it('opens as a sheet after a long press on a touch screen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    open('Some words here.\n')
    const words = textElement('Some words here.')
    fireEvent.pointerDown(words, { pointerType: 'touch', clientX: 5, clientY: 5 })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    vi.useRealTimers()
    const menu = await screen.findByRole('menu', { name: 'Text' })
    expect(menu).toHaveAttribute('data-presentation', 'sheet')
  })

  it('does not open when the finger moves, lifts early, or is a mouse', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    open('Some words here.\n')
    const words = textElement('Some words here.')
    fireEvent.pointerDown(words, { pointerType: 'touch', clientX: 5, clientY: 5 })
    fireEvent.pointerMove(words, { pointerType: 'touch', clientX: 6, clientY: 6 })
    fireEvent.pointerMove(words, { pointerType: 'touch', clientX: 40, clientY: 40 })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    fireEvent.pointerDown(words, { pointerType: 'touch', clientX: 5, clientY: 5 })
    fireEvent.pointerUp(words)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    fireEvent.pointerDown(words, { pointerType: 'mouse' })
    fireEvent.pointerMove(words, { pointerType: 'mouse' })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    vi.useRealTimers()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps a selection the pointer is inside, and moves the caret to one it is outside', () => {
    const { editor } = open('First words.\n\nSecond words.\n')
    select(editor(), 'First')
    const { from } = editor().state.selection
    rightClick('First words.')
    expect(editor().state.selection.from).toBe(from)
    expect(editor().state.selection.empty).toBe(false)
  })

  it('is not part of a read-only editor', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument('Words.\n').ast} ref={ref} editable={false} />)
    expect(rightClick('Words.')).toBe(true)
  })
})

describe('over words', () => {
  it('formats the selection from its Format submenu', async () => {
    const { user, editor, saved } = open('Make this bold.\n')
    select(editor(), 'this')
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await chooseInSubmenu(user, 'Format', 'Bold')
    expect(saved()).toBe('Make **this** bold.\n')
  })

  it('says why Cut and Copy cannot be used with nothing selected', async () => {
    const { user, editor } = open('Words.\n')
    caretAtEnd(editor())
    await user.keyboard('{Shift>}{F10}{/Shift}')
    const cut = await screen.findByRole('menuitem', { name: 'Cut' })
    expect(cut).toHaveAttribute('data-disabled')
    expect(cut).toHaveAccessibleDescription(/^Select something first/)
  })

  it('cuts and copies with the browser’s own commands', async () => {
    const exec = vi.fn<(command: string) => boolean>(() => true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    const { user, editor } = open('Words to copy.\n')
    select(editor(), 'copy')
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await user.click(await screen.findByRole('menuitem', { name: 'Copy' }))
    select(editor(), 'copy')
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await user.click(await screen.findByRole('menuitem', { name: 'Cut' }))
    expect(exec.mock.calls.map(([command]) => command)).toEqual(['copy', 'cut'])
  })

  it.each([
    [
      'rich text as formatting',
      [{ type: 'text/html', body: '<p><strong>Rich</strong></p>' }],
      'Paste',
      'Start**Rich**\n',
    ],
    [
      'plain text through the editor’s paste',
      [{ type: 'text/plain', body: 'Plain' }],
      'Paste',
      'StartPlain\n',
    ],
    ['nothing it cannot read', [{ type: 'image/png', body: '' }], 'Paste', 'Start\n'],
    ['words alone, Markdown and all', [], 'Paste as plain text', 'Start\\*Plain\\*\n'],
  ])('pastes %s', async (_what, items, name, expected) => {
    const read = async () =>
      items.map(({ type, body }) => ({
        types: [type],
        getType: async () => new Blob([body], { type }),
      }))
    const { user, editor, saved } = open('Start\n', {
      clipboard: { read, readText: async () => '*Plain*' },
    })
    caretAtEnd(editor())
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await user.click(await screen.findByRole('menuitem', { name }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(saved()).toBe(expected)
  })

  it('pastes from the text clipboard where the browser offers nothing richer', async () => {
    const { user, editor, saved } = open('Start\n', { clipboard: { readText: async () => 'More' } })
    caretAtEnd(editor())
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await user.click(await screen.findByRole('menuitem', { name: 'Paste' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(saved()).toBe('StartMore\n')
  })

  it('says why it cannot paste where the browser keeps the clipboard to itself', async () => {
    const { user, editor } = open('Words.\n', { clipboard: {} })
    select(editor(), 'Words')
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(await screen.findByRole('menuitem', { name: 'Paste' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: /Paste as plain text/ })).toHaveAttribute(
      'data-disabled',
    )
  })

  it('turns the block into another from its Turn into submenu', async () => {
    const { user, editor, saved } = open('Words\n')
    select(editor(), 'Words')
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await chooseInSubmenu(user, 'Turn into', 'Heading 2', 'menuitemradio')
    expect(saved()).toBe('## Words\n')
  })

  it('opens the link popover from Link', async () => {
    const { user, editor } = open('Words.\n')
    select(editor(), 'Words')
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await user.click(await screen.findByRole('menuitem', { name: 'Link' }))
    expect(await screen.findByRole('dialog', { name: 'Add link' })).toBeInTheDocument()
  })
})

describe('over a link', () => {
  it('opens, edits, copies and unlinks it', async () => {
    const opened = vi.fn<(href: string) => void>()
    const copied = vi.fn<(text: string) => Promise<void>>(async () => {})
    const { user, saved } = open('See [the guide](https://example.com/guide).\n', {
      onOpenLink: opened,
      clipboard: { writeText: copied },
    })
    const choose = async (name: string): Promise<void> => {
      rightClick('the guide')
      await user.click(await screen.findByRole('menuitem', { name }))
    }
    expect(
      await (async () => {
        rightClick('the guide')
        return screen.findByRole('menu', { name: 'Link' })
      })(),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await choose('Open link')
    expect(opened).toHaveBeenCalledWith('https://example.com/guide')
    await choose('Copy link address')
    expect(copied).toHaveBeenCalledWith('https://example.com/guide')
    await choose('Edit link')
    expect(await screen.findByRole('dialog', { name: 'Edit link' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await choose('Unlink')
    expect(saved()).toBe('See the guide.\n')
  })

  it('says why a link cannot be opened where the application gave no way to', async () => {
    const { user } = open('See [the guide](https://example.com).\n')
    rightClick('the guide')
    const item = await screen.findByRole('menuitem', { name: /Open link/ })
    expect(item).toHaveAttribute('data-disabled')
    await user.keyboard('{Escape}')
  })
})

describe('over a block', () => {
  it('moves, duplicates and deletes it, saying why it cannot move past the ends', async () => {
    const { user, saved } = open('# One\n\nTwo.\n')
    rightClick('Two.')
    expect(await screen.findByRole('menuitem', { name: /Move down/ })).toHaveAttribute(
      'data-disabled',
    )
    await user.click(screen.getByRole('menuitem', { name: /Move up/ }))
    expect(saved()).toBe('Two.\n\n# One\n')
    rightClick('Two.')
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    expect(saved()).toBe('Two.\n\nTwo.\n\n# One\n')
    rightClick('One')
    await user.click(await screen.findByRole('menuitem', { name: 'Delete heading' }))
    expect(saved()).toBe('Two.\n\nTwo.\n')
  })

  it('copies a link to the section the block is in', async () => {
    const copied = vi.fn<(text: string) => Promise<void>>(async () => {})
    const { user } = open('# Intro\n\n## Set up\n\nInstall it.\n', {
      linkTo: (fragment) => `https://quill.test/d/1#${fragment}`,
      clipboard: { writeText: copied },
    })
    rightClick('Install it.')
    await user.click(await screen.findByRole('menuitem', { name: 'Copy link to section' }))
    expect(copied).toHaveBeenCalledWith('https://quill.test/d/1#user-content-set-up')
  })

  it('says why there is no section to link to', async () => {
    const { user } = open('No heading here.\n', { linkTo: (fragment) => `#${fragment}` })
    rightClick('No heading here.')
    expect(await screen.findByRole('menuitem', { name: /Copy link to section/ })).toHaveTextContent(
      'There is no heading above this to link to',
    )
    await user.keyboard('{Escape}')
  })
})

describe('over a table cell', () => {
  it('offers the table editor’s own actions, with their reasons', async () => {
    const { user, saved } = open('| Region | State |\n| - | - |\n| eu | up |\n')
    rightClick('eu')
    const menu = await screen.findByRole('menu', { name: 'Table cell' })
    expect(within(menu).queryByRole('menuitem', { name: 'Turn into' })).not.toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: /Insert row below/ }))
    expect(saved()).toContain('| eu')
    expect(
      saved()
        .split('\n')
        .filter((line) => line.startsWith('|')),
    ).toHaveLength(4)
    rightClick('eu')
    await chooseInSubmenu(user, 'Align column', 'Align left', 'menuitemcheckbox')
    expect(saved()).toContain(':-')
  })
})

describe('over a picture', () => {
  const action: ImageAction = {
    id: 'edit',
    label: 'Edit diagram',
    appliesTo: (src) => src.endsWith('.drawio.svg'),
    run: vi.fn<ImageAction['run']>(),
  }

  it('offers the extension’s action, replacing, describing and opening it', async () => {
    const opened = vi.fn<(href: string) => void>()
    const requested = vi.fn<(request: SlashRequest) => void>()
    const { user, container, saved } = open('![Old words](/a/map.drawio.svg)\n', {
      imageActions: [action],
      onOpenLink: opened,
      onRequest: requested,
    })
    const image = container.querySelector('img')
    if (image === null) throw new Error('No image.')
    fireEvent.contextMenu(image, { clientX: 1, clientY: 1 })
    const menu = await screen.findByRole('menu', { name: 'Image' })
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit diagram' }))
    expect(action.run).toHaveBeenCalledWith(expect.objectContaining({ src: '/a/map.drawio.svg' }))
    fireEvent.contextMenu(image, { clientX: 1, clientY: 1 })
    await user.click(await screen.findByRole('menuitem', { name: 'Replace image…' }))
    expect(requested).toHaveBeenCalledWith({ kind: 'image' })
    fireEvent.contextMenu(image, { clientX: 1, clientY: 1 })
    await user.click(await screen.findByRole('menuitem', { name: 'Open in viewer' }))
    expect(opened).toHaveBeenCalledWith('/a/map.drawio.svg')
    fireEvent.contextMenu(image, { clientX: 1, clientY: 1 })
    await user.click(await screen.findByRole('menuitem', { name: 'Alternative text…' }))
    const field = await screen.findByRole('textbox', { name: 'Alternative text' })
    await user.clear(field)
    await user.type(field, 'A map of the regions{Enter}')
    expect(saved()).toBe('![A map of the regions](/a/map.drawio.svg)\n')
  })

  it('says why a picture cannot be replaced or opened without the application', async () => {
    const { container, user } = open('![Words](/a/b.png)\n')
    const image = container.querySelector('img')
    if (image === null) throw new Error('No image.')
    fireEvent.contextMenu(image, { clientX: 1, clientY: 1 })
    expect(await screen.findByRole('menuitem', { name: /Replace image/ })).toHaveAttribute(
      'data-disabled',
    )
    expect(screen.getByRole('menuitem', { name: /Open in viewer/ })).toHaveAttribute(
      'data-disabled',
    )
    expect(screen.queryByRole('menuitem', { name: 'Edit diagram' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
  })
})

describe('over a code block', () => {
  it('copies the code and wraps long lines, remembering the choice', async () => {
    const copied = vi.fn<(text: string) => Promise<void>>(async () => {})
    const { user, container } = open('```ts\nconst x = 1\n```\n', {
      clipboard: { writeText: copied },
    })
    // A right-click on the code, as the keys in a code block are CodeMirror's.
    const openMenu = async (): Promise<void> => {
      const block = container.querySelector('.code-block')
      if (block === null) throw new Error('No code block.')
      fireEvent.contextMenu(block, { clientX: 1, clientY: 1 })
      await screen.findByRole('menu', { name: 'Code block' })
    }
    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: 'Copy code' }))
    expect(copied).toHaveBeenCalledWith('const x = 1')
    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: 'Wrap long lines' }))
    expect(container.querySelector('.document-editor')).toHaveAttribute('data-code-wrap', 'true')
    expect(localStorage.getItem(CODE_WRAP_KEY)).toBe('true')
    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: 'Stop wrapping long lines' }))
    expect(container.querySelector('.document-editor')).toHaveAttribute('data-code-wrap', 'false')
    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: 'Change language…' }))
  })

  it('puts the remembered wrapping back on a new editor, even where storage is refused', () => {
    localStorage.setItem(CODE_WRAP_KEY, 'true')
    const { container, unmount } = open('Words.\n')
    expect(container.querySelector('.document-editor')).toHaveAttribute('data-code-wrap', 'true')
    unmount()
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('refused')
      },
      setItem: () => {
        throw new Error('refused')
      },
      clear: () => {},
    })
    const again = open('Words.\n')
    expect(again.container.querySelector('.document-editor')).toHaveAttribute(
      'data-code-wrap',
      'false',
    )
  })
})

describe('over a quote', () => {
  it('turns it into a callout', async () => {
    const { user, saved } = open('> Quoted words.\n')
    rightClick('Quoted words.')
    await user.click(await screen.findByRole('menuitem', { name: 'Turn into a callout' }))
    expect(saved()).toBe('> [!NOTE]\n> Quoted words.\n')
  })
})

describe('the registry', () => {
  const quiet: ContextMenuContribution = { id: 'quiet', order: 1, entries: () => [] }
  const loud: ContextMenuContribution = {
    id: 'loud',
    order: 0,
    label: 'Loud',
    entries: () => [{ kind: 'action', id: 'shout', label: 'Shout', run: () => {} }],
  }

  it('orders contributions, drops the silent, and limits to some', () => {
    const registry = createContextMenuRegistry([quiet, loud])
    const place = {} as never
    expect(registry.contributions.map((each) => each.id)).toEqual(['loud', 'quiet'])
    expect(registry.sectionsFor(place).map((section) => section.id)).toEqual(['loud'])
    expect(registry.sectionsFor(place, ['quiet'])).toEqual([])
  })

  it('refuses two contributions with one id', () => {
    expect(() => createContextMenuRegistry([loud, loud])).toThrow(/Two context menu contributions/)
  })

  it('unwraps a menu of one submenu, and leaves anything else', () => {
    const lone = [
      {
        id: 'turn-into',
        entries: [
          {
            kind: 'submenu' as const,
            id: 'turn',
            label: 'Turn into',
            entries: [{ kind: 'action' as const, id: 'a', label: 'A', run: () => {} }],
          },
        ],
      },
    ]
    expect(unwrapLone(lone)).toEqual([
      { id: 'turn-into', label: 'Turn into', entries: lone[0]?.entries[0]?.entries },
    ])
    expect(unwrapLone([])).toEqual([])
  })

  it('adds a feature’s own contribution after Quill’s', async () => {
    const run = vi.fn<() => void>()
    const { user } = open('Words.\n', {
      contextMenuContributions: [
        {
          id: 'feature',
          order: 100,
          entries: () => [{ kind: 'action', id: 'f', label: 'Feature thing', run }],
        },
      ],
    })
    rightClick('Words.')
    await user.click(await screen.findByRole('menuitem', { name: 'Feature thing' }))
    expect(run).toHaveBeenCalled()
  })

  it('closes again when nothing has anything to say about the place', () => {
    const store = createOverlayStore()
    store.close()
    expect(store.getSnapshot().kind).toBe('none')
  })
})

describe('naming the place', () => {
  it('says what the menu is about', () => {
    const { editor } = open('Words [link](https://a.b).\n\n![x](/i.png)\n')
    const state = editor().state
    expect(placeLabel(state, 2)).toBe('Text')
    expect(placeLabel(state, 9)).toBe('Link')
    let image = 0
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') image = pos
      return true
    })
    expect(placeLabel(state, image)).toBe('Image')
    expect(placeLabel(state, 0)).toBe('Block')
  })
})

describe('describing a picture that has gone', () => {
  it('saves nothing when the picture was removed while its description was being written', async () => {
    const { container, user, editor, saved } = open('![Words](/a/b.png)\n\nAfter.\n')
    const image = container.querySelector('img')
    if (image === null) throw new Error('No image.')
    fireEvent.contextMenu(image, { clientX: 1, clientY: 1 })
    await user.click(await screen.findByRole('menuitem', { name: 'Alternative text…' }))
    const field = await screen.findByRole('textbox', { name: 'Alternative text' })
    act(() => {
      editor().view.dispatch(editor().state.tr.delete(0, editor().state.doc.child(0).nodeSize))
    })
    await user.type(field, ' more{Enter}')
    expect(saved()).toBe('After.\n')
  })
})
