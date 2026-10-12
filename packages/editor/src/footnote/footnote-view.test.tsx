import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

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
