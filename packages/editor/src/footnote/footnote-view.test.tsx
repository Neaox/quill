import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { EditorView } from '@tiptap/pm/view'
import { FootnoteReferenceView } from './footnote-view.ts'

const NL = String.fromCharCode(10)
const NOTES = 'Claim[^b], then[^a], and again[^b].\n\n[^a]: Alpha.\n\n[^b]: Beta.\n'

function open(source = NOTES) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  return { ref, user: userEvent.setup(), ...result }
}

function editorOf(ref: { current: DocumentEditorHandle | null }) {
  const editor = ref.current?.editor
  if (editor === undefined || editor === null) throw new Error('There is no editor.')
  return editor
}

function references(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('sup.footnote-reference a')]
}

describe('a footnote reference in the editor', () => {
  it('shows its number, as the reader numbers it: by first reference', () => {
    open()

    expect(references().map((link) => link.textContent)).toEqual(['1', '2', '1'])
    expect(screen.getAllByRole('link', { name: 'Footnote 1' })).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Footnote 2' })).toBeInTheDocument()
  })

  it('links to its note', () => {
    open()
    const [first] = references()
    const target = document.querySelector(first?.getAttribute('href') ?? '#none')

    expect(target).toHaveClass('footnote-definition')
    expect(target?.textContent).toContain('Beta.')
  })

  it('takes the caret to its note when followed, without leaving the editor', async () => {
    const { ref, user } = open()
    const [first] = references()
    if (first === undefined) throw new Error('expected a reference')

    await user.click(first)

    const { $from } = editorOf(ref).state.selection
    expect($from.node(1).type.name).toBe('footnoteDefinition')
    expect($from.node(1).attrs['identifier']).toBe('b')
  })

  it('takes the caret to the right note when notes follow it', async () => {
    const { ref, user } = open()
    const second = references()[1]
    if (second === undefined) throw new Error('expected a second reference')

    await user.click(second)

    const { $from } = editorOf(ref).state.selection
    expect($from.node(1).attrs['identifier']).toBe('a')
  })

  it('gives no id to a note nothing refers to', () => {
    open('Claim[^a].' + NL + NL + '[^a]: Alpha.' + NL + NL + '[^z]: Orphan.' + NL)

    const notes = [...document.querySelectorAll('.footnote-definition')]
    expect(notes.map((note) => note.hasAttribute('id'))).toEqual([true, false])
  })

  it('stays where it is when followed to a note that is not there, or a reference with no name', async () => {
    const { ref, user } = open()
    const editor = editorOf(ref)
    const reference = editor.schema.nodes['footnoteReference']
    if (reference === undefined) throw new Error('no footnote schema')
    act(() => {
      editor.view.dispatch(editor.state.tr.insert(1, reference.create({ identifier: 'missing' })))
      editor.view.dispatch(editor.state.tr.insert(1, reference.create()))
    })
    const before = editor.state.selection.from

    const [first, second] = references()
    if (first === undefined || second === undefined) throw new Error('expected references')
    await user.click(first)
    await user.click(second)

    expect(editor.state.selection.from).toBe(before)
    expect(references()).toHaveLength(5)
  })

  it('numbers again when a reference is added before the others', () => {
    const { ref } = open()
    const editor = editorOf(ref)
    const reference = editor.schema.nodes['footnoteReference']
    if (reference === undefined) throw new Error('no footnote schema')

    act(() => {
      editor.view.dispatch(
        editor.state.tr.insert(1, reference.create({ identifier: 'a', label: 'a' })),
      )
    })

    expect(references().map((link) => link.textContent)).toEqual(['1', '2', '1', '2'])

    act(() => {
      editor.view.dispatch(editor.state.tr.delete(1, 2))
    })
    expect(references().map((link) => link.textContent)).toEqual(['1', '2', '1'])

    act(() => {
      editor.view.dispatch(editor.state.tr.insertText('Still ', 1))
    })
    expect(references().map((link) => link.textContent)).toEqual(['1', '2', '1'])
  })

  it('leaves a document without footnotes alone, and writes one back as it was', () => {
    const { ref, unmount } = open()
    expect(
      serializeDocument({
        frontMatter: {},
        ast: ref.current?.toMdast() ?? { type: 'root', children: [] },
      }),
    ).toBe(NOTES)
    unmount()

    const { ref: plain } = open('Plain.\n')
    act(() => {
      editorOf(plain).view.dispatch(editorOf(plain).state.tr.insertText('Still ', 1))
    })
    expect(references()).toEqual([])
  })

  it('has no accessibility violations', async () => {
    const { container } = open()
    await expectNoAccessibilityViolations(container)
  })
})

describe('a footnote reference view on its own', () => {
  function mount() {
    const state = createEditorTestHarness().state(NOTES)
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView(host, { state })
    const reference = state.schema.nodes['footnoteReference']?.create({ identifier: 'a' })
    if (reference === undefined) throw new Error('no footnote schema')
    return { view, reference, nodeView: new FootnoteReferenceView(reference, view, []) }
  }

  it('shows a reference no decoration has numbered as a link with no number', () => {
    const { view, nodeView } = mount()
    expect(nodeView.dom.querySelector('a')).toHaveAttribute('aria-label', 'Footnote')
    view.destroy()
  })

  it('refuses to become a node of another type, and owns every mutation inside itself', () => {
    const { view, nodeView, reference } = mount()
    const paragraph = view.state.schema.nodes['paragraph']?.create()
    if (paragraph === undefined) throw new Error('no paragraph')
    expect(nodeView.update(paragraph, [])).toBe(false)
    expect(nodeView.update(reference, [])).toBe(true)
    expect(nodeView.ignoreMutation()).toBe(true)
    view.destroy()
  })
})
