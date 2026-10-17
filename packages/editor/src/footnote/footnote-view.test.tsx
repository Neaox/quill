import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { FootnoteReferenceView } from './footnote-view.ts'

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

    const second = references()[1]
    if (second === undefined) throw new Error('expected a second reference')
    await user.click(second)
    expect(editorOf(ref).state.selection.$from.node(1).attrs['identifier']).toBe('a')
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

    const { ref: plain } = open('Plain[^a].\n\n[^a]: A.\n\n[^z]: Never cited.\n')
    act(() => {
      editorOf(plain).view.dispatch(editorOf(plain).state.tr.insertText('Still ', 1))
    })
    expect(references().map((link) => link.textContent)).toEqual(['1'])
    const unused = [...document.querySelectorAll('.footnote-definition')].filter(
      (note) => !note.hasAttribute('id'),
    )
    expect(unused).toHaveLength(1)
  })

  it('keeps its numbers through a change of attributes, and drops a note’s link with the note', () => {
    const { ref } = open()
    const editor = editorOf(ref)
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'spread', true))
    })
    expect(references().map((link) => link.textContent)).toEqual(['1', '2', '1'])

    let note = -1
    editor.state.doc.forEach((node, offset) => {
      if (node.attrs['identifier'] === 'b') note = offset
    })
    act(() => {
      const found = editor.state.doc.nodeAt(note)
      if (found === null) throw new Error('expected the note')
      editor.view.dispatch(editor.state.tr.delete(note, note + found.nodeSize))
    })
    expect(document.querySelector(references()[0]?.getAttribute('href') ?? '#none')).toBeNull()
  })

  it('draws a reference it has no number for, and follows nowhere when its note is gone', () => {
    const { ref } = open()
    const editor = editorOf(ref)
    const reference = editor.schema.nodes['footnoteReference']
    const paragraph = editor.schema.nodes['paragraph']
    if (reference === undefined || paragraph === undefined) throw new Error('no schema')
    const before = editor.state.selection.from
    const view = new FootnoteReferenceView(reference.create({}), editor.view, [])
    const link = view.dom.querySelector('a')
    if (link === null) throw new Error('expected a link')

    expect(link.textContent).toBe('')
    expect(link).toHaveAttribute('aria-label', 'Footnote')
    link.click()
    expect(editor.state.selection.from).toBe(before)

    expect(view.update(paragraph.create(), [])).toBe(false)
    expect(view.update(reference.create({ identifier: 'x' }), [])).toBe(true)
    expect(view.stopEvent(new Event('click'))).toBe(false)
    expect(view.ignoreMutation()).toBe(true)
  })

  it('numbers nothing in a document without footnotes, however it is typed in', () => {
    const { ref } = open('Plain.\n')
    act(() => {
      editorOf(ref).view.dispatch(editorOf(ref).state.tr.insertText('Still ', 1))
    })
    expect(references()).toEqual([])
    expect(document.querySelector('[id*="-footnote-"]')).toBeNull()
  })

  it('has no accessibility violations', async () => {
    const { container } = open()
    await expectNoAccessibilityViolations(container)
  })
})
