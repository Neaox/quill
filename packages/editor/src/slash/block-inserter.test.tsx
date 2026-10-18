import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AllSelection, EditorState, TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { documentFromMdast, documentToMdast } from '../document/ast.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { editorSchema } from '../schema/editor-schema.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { BlockInserter, gutterPosition, openInsertMenu } from './block-inserter.tsx'

const NL = String.fromCharCode(10)

function stateAt(markdown: string, position: number): EditorState {
  const state = EditorState.create({
    schema: editorSchema,
    doc: documentFromMdast(parseDocument(markdown).ast).doc,
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, position)))
}

function apply(state: EditorState): { markdown: string; state: EditorState } {
  let next = state
  expect(
    openInsertMenu(state, (transaction) => {
      next = state.apply(transaction)
    }),
  ).toBe(true)
  return {
    state: next,
    markdown: serializeDocument({ frontMatter: {}, ast: documentToMdast(next.doc).tree }),
  }
}

describe('opening the insert menu from the gutter', () => {
  it('types a slash on the caret’s line when that line is empty', () => {
    const { markdown, state } = apply(stateAt('\n', 1))
    expect(markdown).toBe('/\n')
    expect(state.selection.$from.parent.textContent).toBe('/')
  })

  it('opens a fresh line after the block otherwise', () => {
    const { markdown } = apply(stateAt('One\n\nTwo\n', 2))
    expect(markdown).toBe('One\n\n/\n\nTwo\n')
  })

  it('answers without acting when asked whether it can', () => {
    expect(openInsertMenu(stateAt('One\n', 1))).toBe(true)
  })

  it('has nothing to do with no block to be beside', () => {
    const state = stateAt('One\n', 1)
    const everything = state.apply(state.tr.setSelection(new AllSelection(state.doc)))
    expect(openInsertMenu(everything)).toBe(false)
  })
})

describe('the insert button', () => {
  it('opens the slash menu, and passes axe', async () => {
    const ref = createRef<DocumentEditorHandle>()
    const { container } = render(<DocumentEditor ast={parseDocument('Words\n').ast} ref={ref} />)
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Insert a block' })
    await expectNoAccessibilityViolations(container)
    await user.click(button)
    expect(screen.getByRole('listbox', { name: 'Insert a block' })).toBeVisible()
    await user.keyboard('divider{Enter}')
    const handle = ref.current
    if (handle === null) throw new Error('No editor.')
    expect(serializeDocument({ frontMatter: {}, ast: handle.toMdast() })).toBe('Words\n\n---\n\n')
  })

  it('is reachable from the keyboard', async () => {
    render(<DocumentEditor ast={parseDocument('Words\n').ast} />)
    const user = userEvent.setup()
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Insert a block' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('listbox', { name: 'Insert a block' })).toBeVisible()
  })

  it('is not there in a read-only document, or before the editor exists', () => {
    render(<DocumentEditor ast={parseDocument('Words\n').ast} editable={false} />)
    expect(screen.queryByRole('button', { name: 'Insert a block' })).toBeNull()
    const { container } = render(<BlockInserter editor={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('sits beside the caret’s block, measured against the editor’s frame', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument('Words\n').ast} ref={ref} />)
    const editor = ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('No editor.')
    const block = editor.view.nodeDOM(0)
    if (!(block instanceof HTMLElement)) throw new Error('No block.')
    block.getBoundingClientRect = () => new DOMRect(100, 40, 600, 24)
    expect(gutterPosition(editor)).toEqual({ top: 40, left: 66 })
    block.getBoundingClientRect = () => new DOMRect(10, 40, 600, 24)
    expect(gutterPosition(editor)?.left).toBe(-24)
  })

  it('is measured in the next frame, not while the caret’s move is being drawn', async () => {
    // Measured while React renders, the layout is read straight after
    // ProseMirror has written the new block, and laid out again for it.
    const ref = createRef<DocumentEditorHandle>()
    const { container } = render(
      <DocumentEditor ast={parseDocument('One\n\nTwo\n').ast} ref={ref} />,
    )
    const editor = ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('No editor.')
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    const second = editor.view.nodeDOM(5)
    if (!(second instanceof HTMLElement)) throw new Error('No second block.')
    const measure = vi.fn<() => DOMRect>(() => new DOMRect(100, 80, 600, 24))
    second.getBoundingClientRect = measure

    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)))
    })
    expect(measure).not.toHaveBeenCalled()

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(measure).toHaveBeenCalled()
    const gutter = container.querySelector<HTMLElement>('.block-inserter')
    expect(gutter?.style.top).toBe('80px')
    expect(gutter?.style.left).toBe('66px')
  })

  it('hides itself when the caret’s block has nothing drawn to sit beside', async () => {
    const ref = createRef<DocumentEditorHandle>()
    const { container } = render(
      <DocumentEditor ast={parseDocument('One' + NL + NL + 'Two' + NL).ast} ref={ref} />,
    )
    const editor = ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('No editor.')
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    vi.spyOn(editor.view, 'nodeDOM').mockReturnValue(null)

    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)))
    })
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    expect(container.querySelector<HTMLElement>('.block-inserter')?.hidden).toBe(true)
  })

  it('has no place without a block or a frame to measure against', () => {
    const state = stateAt('One\n', 1)
    const everything = state.apply(state.tr.setSelection(new AllSelection(state.doc)))
    const view = { nodeDOM: () => null, dom: document.createElement('div') }
    expect(gutterPosition({ state: everything, view } as unknown as Editor)).toBeNull()
    expect(gutterPosition({ state, view } as unknown as Editor)).toBeNull()
  })
})
