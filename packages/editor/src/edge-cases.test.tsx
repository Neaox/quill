import { parseDocument } from '@quill/markdown'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import { Extension } from '@tiptap/core'
import { AllSelection, EditorState } from '@tiptap/pm/state'
import { EditorView as ProseMirrorView } from '@tiptap/pm/view'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { duplicateBlock } from './block/commands.ts'
import { CodeBlockNodeView } from './code-block/code-block-view.ts'
import { DocumentEditor } from './document/document-editor.tsx'
import type { DocumentEditorHandle } from './document/document-editor.tsx'
import { runAt } from './menu/use-menu-navigation.ts'
import { withDom } from './schema/dom.ts'
import { editorSchema } from './schema/editor-schema.ts'
import { rectOf } from './slash/slash-extension.ts'
import { SLASH_ITEMS } from './slash/slash-items.ts'
import { SlashMenu } from './slash/slash-menu.tsx'
import { createSlashStore } from './slash/slash-store.ts'
import { createEditorTestHarness } from './testing/harness.ts'
import { DirectiveNodeView } from './template/directive-view.ts'
import { dismiss, dismissalKey } from './template/dismissal.ts'
import { templateProgress } from './template/progress.ts'
import { requiredDecorations, requiredHeadings } from './template/required-markers.ts'

/**
 * What each piece does when it is asked for something it cannot give: an index
 * that no longer exists, a node that has left the document, a caret the browser
 * cannot place. Every one of these is reachable in a real editor, and every one
 * of them has to be quiet rather than throw.
 */

const harness = createEditorTestHarness()

const FENCED = ['```ts', 'const a = 1', '```', ''].join('\n')

function mounted(markdown: string) {
  const state = harness.state(markdown)
  const host = document.createElement('div')
  document.body.append(host)
  return { view: new ProseMirrorView(host, { state }) }
}

describe('a menu asked for an item that is not there', () => {
  it('does nothing, and says it did nothing', () => {
    const ran = vi.fn<() => void>()
    expect(runAt([ran], 0)).toBe(true)
    expect(runAt([ran], 3)).toBe(false)
    expect(ran).toHaveBeenCalledTimes(1)
  })
})

describe('a block command with no block to act on', () => {
  it('declines rather than throwing', () => {
    const state = harness.state('Only.\n')
    const whole = state.apply(state.tr.setSelection(new AllSelection(state.doc)))
    expect(duplicateBlock(whole)).toBe(false)
  })
})

describe('the extension list', () => {
  it('leaves an extension that is neither a node nor a mark alone', () => {
    const plain = Extension.create({ name: 'plain' })
    expect(withDom([plain])).toEqual([plain])
  })
})

describe('the slash menu with nowhere to put itself', () => {
  it('has no rectangle when the browser cannot say where the caret is', () => {
    expect(rectOf(null)).toBeNull()
    expect(rectOf(() => null)).toBeNull()
  })

  it('renders without a position when it was given none', () => {
    const store = createSlashStore()
    render(<SlashMenu store={store} editor={null} />)
    act(() => {
      store.open({ query: '', items: SLASH_ITEMS.slice(0, 1), rect: null, apply: () => {} })
    })
    expect(screen.getByRole('listbox', { name: 'Insert' }).getAttribute('style')).toBeNull()
  })
})

describe('a directive card', () => {
  it('keeps its own chrome out of what the document is told about', () => {
    const { view } = mounted(':::guidance\nAdvice.\n:::\n')
    const nodeView = new DirectiveNodeView(view.state.doc.child(0), view, () => 0, [])
    expect(nodeView.ignoreMutation({ target: nodeView.dom })).toBe(true)
    expect(nodeView.ignoreMutation({ target: nodeView.contentDOM })).toBe(false)
    view.destroy()
  })

  it('cannot be dismissed once it has left the document', () => {
    const state = harness.state('Just prose.\n')
    expect(dismiss(state.doc.content.size)(state)).toBe(false)
    expect(dismiss(0)(state)).toBe(true)
  })

  it('ignores a dismissal aimed at a block that is no longer there', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument(':::guidance\nAdvice.\n:::\n').ast} ref={ref} />)
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')
    act(() => {
      editor.view.dispatch(editor.state.tr.setMeta(dismissalKey, editor.state.doc.content.size))
    })
    expect(dismissalKey.getState(editor.state)?.find()).toEqual([])
  })

  it('keeps a dismissal as the author writes around it', async () => {
    const user = userEvent.setup()
    const ref = createRef<DocumentEditorHandle>()
    render(
      <DocumentEditor ast={parseDocument(':::guidance\nAdvice.\n:::\n\nAfter.\n').ast} ref={ref} />,
    )
    await user.click(screen.getByRole('button', { name: 'Dismiss guidance' }))
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      editor.commands.insertContent(' More.')
    })
    expect(dismissalKey.getState(editor.state)?.find()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Dismiss guidance' })).not.toBeInTheDocument()
  })
})

describe('a heading whose text is not text', () => {
  it('reads as nothing at all rather than throwing', () => {
    const source = [
      '---',
      'template:',
      '  name: T',
      '  version: 1',
      '  sections:',
      '    - heading: An image',
      '---',
      '',
      '## ![A diagram](/d.svg)',
      '',
    ].join('\n')
    expect(templateProgress(parseDocument(source).ast).sections[0]?.status).toBe('not-added')
  })
})

describe('an empty document', () => {
  it('has no required sections and no decorations', () => {
    const empty = editorSchema.topNodeType.create()
    expect(requiredHeadings(empty).size).toBe(0)
    expect(requiredDecorations(empty).find()).toEqual([])
  })
})

describe('a code block that has left the document', () => {
  it('does not try to give the caret back to a block that is gone', () => {
    const { view } = mounted(FENCED)
    const nodeView = new CodeBlockNodeView(view.state.doc.child(0), view, () => undefined)
    const inner = CodeMirrorView.findFromDOM(nodeView.dom)
    const before = view.state.selection.from
    inner?.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(view.state.selection.from).toBe(before)
    nodeView.destroy()
    view.destroy()
  })

  it('writes nothing when the text has not actually changed', () => {
    const { view } = mounted(FENCED)
    const nodeView = new CodeBlockNodeView(view.state.doc.child(0), view, () => 0)
    const inner = CodeMirrorView.findFromDOM(nodeView.dom)
    const before = view.state.doc.toString()
    inner?.dispatch({ changes: { from: 0, to: 1, insert: 'c' } })
    expect(view.state.doc.toString()).toBe(before)
    nodeView.destroy()
    view.destroy()
  })
})

describe('the block menu under the pointer', () => {
  it('follows the pointer onto a width', async () => {
    const user = userEvent.setup()
    render(<DocumentEditor ast={parseDocument('A paragraph.\n').ast} />)
    await user.click(screen.getByRole('button', { name: /options$/ }))
    const wide = screen.getByRole('menuitemradio', { name: 'Wide' })
    await user.hover(wide)
    expect(screen.getByRole('menu')).toHaveAttribute('aria-activedescendant', wide.id)
  })
})

describe('a placeholder that stands for a phrase', () => {
  it('becomes the text itself, not a paragraph of its own', () => {
    const { view } = mounted('Before :placeholder[a phrase] after.\n')
    let inside = -1
    view.state.doc.descendants((node, pos) => {
      if (node.attrs['name'] === 'placeholder') inside = pos + 1
    })
    expect(inside).toBeGreaterThan(0)

    const state = EditorState.create({
      schema: editorSchema,
      doc: view.state.doc,
      plugins: [...view.state.plugins],
    })
    expect(state.doc.textBetween(0, state.doc.content.size, ' ')).toContain('a phrase')
    view.destroy()
  })
})
