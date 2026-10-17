import { parseDocument } from '@quill/markdown'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AllSelection, TextSelection } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { blockMenu } from '../block/block-context-menu.ts'
import { calloutMenu } from '../callout/callout-menu.ts'
import { CalloutView } from '../callout/callout-view.ts'
import { calloutAt, calloutOf, setCalloutType } from '../callout/callout.ts'
import {
  codeBlockMenu,
  focusLanguage,
  isWrapping,
  setWrapping,
} from '../code-block/code-block-menu.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { createSelectionWatch } from '../format/selection-watch.ts'
import { pasteInto, pasteSource, plainSource, textMenu, turnIntoMenu } from '../format/text-menu.ts'
import { imageMenu } from '../image/image-context-menu.ts'
import { applyLink } from '../link/link-commands.ts'
import { linkMenu } from '../link/link-menu.ts'
import { openLinkPopover } from '../link/open-link-popover.ts'
import { copySectionLink } from '../link/section-link.ts'
import { nodeType } from '../schema/node-type.ts'
import { tableMenu } from '../table/table-context-menu.ts'
import type {
  ContextMenuEnvironment,
  MenuAction,
  MenuEntry,
  MenuPlace,
} from './context-menu-registry.ts'
import { createContextMenuRegistry } from './context-menu-registry.ts'
import { EditorContextMenu } from './editor-context-menu.tsx'
import { createOverlayStore } from './overlay-store.ts'
import { openAtCaret, placeLabel, targetNode } from './context-menu-trigger.ts'

/**
 * Each feature's part of the context menu, asked directly about a place:
 * what it offers where, and what its entries do when they cannot.
 */

function mount(markdown: string, editable = true) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(
    <DocumentEditor ast={parseDocument(markdown).ast} ref={ref} editable={editable} />,
  )
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('No editor.')
  return { ...result, editor }
}

function placeIn(
  editor: ReturnType<typeof mount>['editor'],
  pos: number,
  environment: ContextMenuEnvironment = {},
): MenuPlace {
  return {
    view: editor.view,
    state: editor.state,
    pos,
    environment,
    editor: { editLink: vi.fn<() => void>(), editAltText: vi.fn<(pos: number) => void>() },
  }
}

function action(entries: readonly MenuEntry[], id: string): MenuAction {
  const found = entries.find((entry) => entry.id === id)
  if (found?.kind !== 'action') throw new Error(`No action "${id}".`)
  return found
}

describe('where a part of the menu has nothing to say', () => {
  it('offers no block entries over the whole document, and no table entries outside one', () => {
    const { editor } = mount('Words.\n')
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)))
    })
    expect(blockMenu.entries(placeIn(editor, 0))).toEqual([])
    expect(tableMenu.entries(placeIn(editor, 1))).toEqual([])
    expect(calloutMenu.entries(placeIn(editor, 1))).toEqual([])
    expect(codeBlockMenu.entries(placeIn(editor, 1))).toEqual([])
    expect(linkMenu.entries(placeIn(editor, 1))).toEqual([])
    expect(imageMenu([]).entries(placeIn(editor, 1))).toEqual([])
  })
})

describe('entries that cannot act', () => {
  it('pastes nothing and opens nothing where the application gave no way to', async () => {
    const { editor } = mount('See [it](https://a.b).\n\n![](</i.png>)\n')
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 5)))
    })
    const text = textMenu.entries(placeIn(editor, 5))
    expect(action(text, 'paste').disabledReason).toBeDefined()
    action(text, 'paste').run()
    action(text, 'paste-plain').run()
    const link = linkMenu.entries(placeIn(editor, 5))
    action(link, 'open-link').run()
    action(link, 'copy-link').run()
    let image = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') image = pos
      return true
    })
    const pictures = imageMenu([]).entries(placeIn(editor, image))
    action(pictures, 'replace-image').run()
    action(pictures, 'open-image').run()
    expect(action(pictures, 'open-image').disabledReason).toBe('This picture cannot be opened here')
  })

  it('reads a picture with no address as having none', () => {
    const { editor } = mount('Words.\n')
    const image = nodeType(editor.schema, 'image').create({ src: null })
    act(() => {
      editor.view.dispatch(editor.state.tr.insert(1, image))
    })
    const entries = imageMenu([]).entries(
      placeIn(editor, 1, { openLink: vi.fn<(href: string) => void>() }),
    )
    expect(action(entries, 'open-image').disabledReason).toBeDefined()
  })

  it('ignores a callout type it does not know', () => {
    const { editor } = mount('> [!NOTE]\n> Body.\n')
    const entries = calloutMenu.entries(placeIn(editor, 2))
    const choice = entries.find((entry) => entry.kind === 'choice')
    if (choice?.kind !== 'choice') throw new Error('No choice.')
    choice.choose('aside')
    expect(calloutAt(editor.state, 2)?.type).toBe('note')
  })

  it('copies no section link above the first heading', async () => {
    const { editor } = mount('Words.\n')
    const copyText = vi.fn<(text: string) => Promise<void>>(async () => {})
    expect(copySectionLink(editor.state, 1, { linkTo: (f) => f, copyText })).toBe(false)
    expect(copyText).not.toHaveBeenCalled()
  })
})

describe('the clipboard', () => {
  it('reads everything, only text, or nothing, as the browser allows', async () => {
    expect(pasteSource(undefined)).toBeUndefined()
    expect(pasteSource({})).toBeUndefined()
    expect(await pasteSource({ readText: async () => 'Words' })?.()).toEqual({ text: 'Words' })
    expect(plainSource(undefined)).toBeUndefined()
    expect(await plainSource({ readText: async () => 'Words' })?.()).toBe('Words')
  })

  it('pastes nothing when the clipboard held nothing the editor reads', () => {
    const { editor } = mount('Words.\n')
    const before = editor.state.doc.toJSON()
    act(() => {
      pasteInto(editor.view, {})
    })
    expect(editor.state.doc.toJSON()).toEqual(before)
  })
})

describe('code blocks', () => {
  it('wraps the document itself where there is no editor around it, and focuses nothing it cannot', () => {
    const { editor, container } = mount('```\ncode\n```\n')
    const host = container.querySelector('.document-editor')
    host?.classList.remove('document-editor')
    setWrapping(editor.view, true)
    expect(editor.view.dom.dataset['codeWrap']).toBe('true')
    expect(isWrapping(editor.view)).toBe(true)
    focusLanguage(null)
    focusLanguage(document.createElement('div'))
    expect(document.activeElement).toBe(document.body)
  })
})

describe('the callout view', () => {
  it('keeps its own title line and button to itself', () => {
    const { editor } = mount('> [!TIP]\n> Body.\n')
    const callout = calloutOf(editor.state.doc.child(0), 0)
    if (callout === undefined) throw new Error('No callout.')
    const view = new CalloutView(callout, () => 0, {})
    const button = view.dom.querySelector('button')
    if (button === null) throw new Error('No button.')
    expect(view.stopEvent(new MouseEvent('click'))).toBe(false)
    const click = new MouseEvent('click')
    Object.defineProperty(click, 'target', { value: button })
    expect(view.stopEvent(click)).toBe(true)
    expect(view.ignoreMutation({ target: button })).toBe(true)
    expect(view.ignoreMutation({ target: view.contentDOM })).toBe(false)
    // With nowhere for it to go, the button does nothing.
    button.click()
    const gone = new CalloutView(callout, () => undefined, { onTypeMenu: vi.fn<() => void>() })
    gone.dom.querySelector('button')?.click()
  })

  it('reads attributes that are missing, or have no value, as nothing', () => {
    const { editor } = mount('Words.\n')
    const directive = nodeType(editor.schema, 'containerDirective')
    const paragraph = nodeType(editor.schema, 'paragraph').create()
    expect(
      calloutOf(directive.create({ name: 'callout', attributes: null }, paragraph), 0)?.type,
    ).toBe('note')
    expect(
      calloutOf(directive.create({ name: 'callout', attributes: { type: null } }, paragraph), 0)
        ?.type,
    ).toBe('note')
  })
})

describe('the menu itself', () => {
  it('closes again when nothing has anything to say about the place', () => {
    const { editor } = mount('Words.\n')
    const store = createOverlayStore()
    const registry = createContextMenuRegistry([])
    render(
      <EditorContextMenu
        editor={editor}
        store={store}
        registry={registry}
        environment={{}}
        bridge={{ editLink: vi.fn<() => void>(), editAltText: vi.fn<(pos: number) => void>() }}
      />,
    )
    act(() => {
      store.open({
        kind: 'context-menu',
        anchor: { x: 0, y: 0, width: 0, height: 0 },
        presentation: 'menu',
        pos: 1,
        label: 'Text',
        returnFocus: vi.fn<() => void>(),
      })
    })
    expect(store.getSnapshot().kind).toBe('none')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('draws a choice with no marks beside its options', async () => {
    const { editor } = mount('Words.\n')
    const store = createOverlayStore()
    const choose = vi.fn<(value: string) => void>()
    const registry = createContextMenuRegistry([
      {
        id: 'plain',
        order: 0,
        entries: () => [
          {
            kind: 'choice',
            id: 'c',
            label: 'Kind',
            value: 'a',
            options: [{ value: 'a', label: 'A' }],
            choose,
          },
        ],
      },
    ])
    render(
      <EditorContextMenu
        editor={editor}
        store={store}
        registry={registry}
        environment={{}}
        bridge={{ editLink: vi.fn<() => void>(), editAltText: vi.fn<(pos: number) => void>() }}
      />,
    )
    act(() => {
      store.open({
        kind: 'context-menu',
        anchor: { x: 0, y: 0, width: 0, height: 0 },
        presentation: 'menu',
        pos: 1,
        label: 'Text',
        returnFocus: vi.fn<() => void>(),
      })
    })
    expect(await screen.findByRole('menuitemradio', { name: 'A' })).toBeInTheDocument()
  })
})

describe('the watch over the author', () => {
  it('counts only the main button as starting a drag', () => {
    const { editor } = mount('Words.\n')
    const watch = createSelectionWatch(editor)
    const unsubscribe = watch.subscribe(() => {})
    fireEvent.pointerDown(editor.view.dom, { button: 2 })
    expect(watch.getSnapshot().dragging).toBe(false)
    unsubscribe()
  })

  it('takes an event from outside the document as the document’s own', () => {
    const { editor } = mount('Words.\n')
    expect(targetNode(editor.view, null)).toBe(editor.view.dom)
    expect(targetNode(editor.view, document.body)).toBe(editor.view.dom)
  })
})

describe('the edges of each part', () => {
  it('finds no code block past the end of the document, and says why it cannot copy', () => {
    const { editor } = mount('```\ncode\n```\n')
    expect(codeBlockMenu.entries(placeIn(editor, editor.state.doc.content.size))).toEqual([])
    const entries = codeBlockMenu.entries(placeIn(editor, 0))
    expect(action(entries, 'copy-code').disabledReason).toBe('The clipboard is not available here')
    action(entries, 'copy-code').run()
  })

  it('names a code block from the position before it', () => {
    const { editor } = mount('```\ncode\n```\n')
    expect(placeLabel(editor.state, 0)).toBe('Code block')
  })

  it('calls a link Edit link in the words menu when the caret is inside one', () => {
    const { editor } = mount('See [the guide](https://a.b).\n')
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8)))
    })
    const entries = textMenu.entries(placeIn(editor, 8))
    expect(action(entries, 'link').label).toBe('Edit link')
  })

  it('offers no Turn into for a block it does not know, and ignores a kind it does not', () => {
    const { editor } = mount('#### Deep\n\nWords\n')
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)))
    })
    expect(turnIntoMenu.entries(placeIn(editor, 2))).toEqual([])
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
    })
    const [submenu] = turnIntoMenu.entries(placeIn(editor, editor.state.selection.from))
    if (submenu?.kind !== 'submenu') throw new Error('No submenu.')
    const [choice] = submenu.entries
    if (choice?.kind !== 'choice') throw new Error('No choice.')
    choice.choose('table')
    expect(editor.state.doc.lastChild?.type.name).toBe('paragraph')
  })

  it('refuses to change a callout that is not there', () => {
    const { editor } = mount('Words.\n')
    expect(setCalloutType(editor.state.doc.content.size, 'tip')(editor.state)).toBe(false)
  })

  it('opens no link popover over the whole document', () => {
    const { editor } = mount('Words.\n')
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)))
    })
    const store = createOverlayStore()
    expect(openLinkPopover(editor.view, store)).toBe(false)
  })

  it('keeps formatting the link’s new words carry from around them', () => {
    const { editor } = mount('**Bold words here**\n')
    act(() => {
      applyLink({ from: 6, to: 11, href: 'https://a.b', text: 'link' })(
        editor.state,
        editor.view.dispatch,
      )
    })
    let marks: readonly string[] = []
    editor.state.doc.descendants((node) => {
      if (node.isText && node.text === 'link') marks = node.marks.map((mark) => mark.type.name)
      return true
    })
    expect(marks).toEqual(['bold', 'link'])
  })
})

describe('opening from the pointer and the keyboard', () => {
  it('uses the element the pointer is over where the coordinates say nowhere', () => {
    const { editor, container } = mount('Words here.\n')
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null)
    const words = container.querySelector('p')
    if (words === null) throw new Error('No paragraph.')
    fireEvent.contextMenu(words, { clientX: 1, clientY: 1 })
    expect(screen.getByRole('menu', { name: 'Text' })).toBeInTheDocument()
  })

  it('opens a sheet when the browser reports a long press as a context menu', () => {
    const { editor } = mount('Words here.\n')
    fireEvent.pointerDown(editor.view.dom, { pointerType: 'touch', clientX: 1, clientY: 1 })
    fireEvent.contextMenu(editor.view.dom, { clientX: 1, clientY: 1 })
    expect(screen.getByRole('menu', { name: /./ })).toHaveAttribute('data-presentation', 'sheet')
  })

  it('does not open a second menu when a long press ends over an open one', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { editor } = mount('Words here.\n')
    fireEvent.pointerDown(editor.view.dom, { pointerType: 'touch', clientX: 1, clientY: 1 })
    fireEvent.contextMenu(editor.view.dom, { clientX: 1, clientY: 1 })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    vi.useRealTimers()
    expect(screen.getAllByRole('menu')).toHaveLength(1)
  })

  it('returns focus only to a document that is still there', () => {
    const { editor } = mount('Words here.\n')
    const store = createOverlayStore()
    const view = editor.view
    openAtCaret(view, store)
    const snapshot = store.getSnapshot()
    if (snapshot.kind !== 'context-menu') throw new Error('Not open.')
    view.destroy()
    expect(() => {
      snapshot.returnFocus()
    }).not.toThrow()
  })
})

describe('a long press over an open menu', () => {
  it('does not open a second', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { editor } = mount('Words here.\n')
    act(() => {
      editor.view.focus()
    })
    fireEvent.keyDown(editor.view.dom, { key: 'F10', shiftKey: true })
    fireEvent.pointerDown(editor.view.dom, { pointerType: 'touch', clientX: 1, clientY: 1 })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    vi.useRealTimers()
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(screen.getByRole('menu')).toHaveAttribute('data-presentation', 'menu')
  })

  it('keeps a link’s words when it is given none', () => {
    const { editor } = mount('Link words.\n')
    act(() => {
      applyLink({ from: 1, to: 5, href: 'https://a.b', text: '' })(
        editor.state,
        editor.view.dispatch,
      )
    })
    expect(editor.state.doc.textContent).toBe('Link words.')
  })
})

describe('a link made at a caret with no words', () => {
  it('reads as its address', () => {
    const { editor } = mount('Start\n')
    act(() => {
      applyLink({ from: 6, to: 6, href: 'https://a.b' })(editor.state, editor.view.dispatch)
    })
    expect(editor.state.doc.textContent).toBe('Starthttps://a.b')
  })
})
