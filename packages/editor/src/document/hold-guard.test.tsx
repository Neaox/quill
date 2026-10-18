import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'
import { heldKeyAtEdge } from './hold-guard.ts'

const harness = createEditorTestHarness()
const TWO = 'First line.\n\nSecond.\n'

/** The two paragraphs, with the caret at `at`: 1 opens the first, 12 ends it, 14 opens the second. */
function caretAt(at: number): EditorState {
  const state = harness.state(TWO)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)))
}

const key = (name: string, repeat: boolean) => new KeyboardEvent('keydown', { key: name, repeat })

describe('whether a held key has reached the edge of its block', () => {
  it('stops a repeating Backspace at the start of a block, and Delete at its end', () => {
    expect(heldKeyAtEdge(key('Backspace', true), caretAt(14))).toBe(true)
    expect(heldKeyAtEdge(key('Delete', true), caretAt(12))).toBe(true)
  })

  it('lets a deliberate press, which is not a repeat, join the blocks as it always has', () => {
    expect(heldKeyAtEdge(key('Backspace', false), caretAt(14))).toBe(false)
    expect(heldKeyAtEdge(key('Delete', false), caretAt(12))).toBe(false)
  })

  it('lets a held key go on erasing inside the block', () => {
    expect(heldKeyAtEdge(key('Backspace', true), caretAt(5))).toBe(false)
    expect(heldKeyAtEdge(key('Delete', true), caretAt(5))).toBe(false)
    // Each key only cares about its own edge.
    expect(heldKeyAtEdge(key('Backspace', true), caretAt(12))).toBe(false)
    expect(heldKeyAtEdge(key('Delete', true), caretAt(14))).toBe(false)
  })

  it('leaves other keys, and a selection that is not a caret, to the editor', () => {
    expect(heldKeyAtEdge(key('a', true), caretAt(14))).toBe(false)
    const state = caretAt(14)
    const range = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 14)))
    expect(heldKeyAtEdge(key('Backspace', true), range)).toBe(false)
    const node = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
    expect(heldKeyAtEdge(key('Backspace', true), node)).toBe(false)
  })
})

describe('holding Backspace in the editor', () => {
  it('stops at the start of the line it cleared instead of joining the one before', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument(TWO).ast} ref={ref} />)
    const surface = screen.getByRole('textbox', { name: 'Document' })
    act(() => {
      ref.current?.editor?.commands.setTextSelection(14)
    })
    const written = () => {
      const handle = ref.current
      if (handle === null) throw new Error('No editor.')
      return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
    }

    const swallowed = !fireEvent.keyDown(surface, { key: 'Backspace', repeat: true })

    expect(swallowed).toBe(true)
    expect(written()).toBe(TWO)
  })
})
