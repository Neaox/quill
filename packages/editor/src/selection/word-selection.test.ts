import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import {
  createWordSelectionPlugin,
  trimAfterDoubleClick,
  trimmedWordSelection,
} from './word-selection.ts'

const harness = createEditorTestHarness()

/** A state with `text` selected from `from` to `to`, as a double click on Windows leaves it. */
function selected(markdown: string, from: number, to: number): EditorState {
  const state = harness.state(markdown)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

/** The words selected. */
function words(state: EditorState): string {
  const { from, to } = state.selection
  return state.doc.textBetween(from, to)
}

describe('the selection a double click leaves', () => {
  it('is the word without the space Windows adds after it', () => {
    const state = selected('Say something clever.\n', 5, 15)
    expect(words(state)).toBe('something ')

    const trimmed = trimmedWordSelection(state)

    expect(trimmed && words(state.apply(state.tr.setSelection(trimmed)))).toBe('something')
  })

  it('drops every space at its end, not just one', () => {
    const state = selected('Say something   clever.\n', 5, 17)

    const trimmed = trimmedWordSelection(state)

    expect(trimmed && words(state.apply(state.tr.setSelection(trimmed)))).toBe('something')
  })

  it('is left as it is when it has no trailing space, as on a Mac', () => {
    expect(trimmedWordSelection(selected('Say something clever.\n', 5, 14))).toBeNull()
  })

  it('is left as it is when what was selected is only space', () => {
    expect(trimmedWordSelection(selected('Say   clever.\n', 4, 7))).toBeNull()
  })

  it('is left as it is for a caret, and for a selection that is not text', () => {
    expect(trimmedWordSelection(selected('Say something clever.\n', 5, 5))).toBeNull()
  })

  it('is left as it is when it runs across blocks, which is no word', () => {
    const state = selected('One two \n\nThree four\n', 5, 14)

    expect(trimmedWordSelection(state)).toBeNull()
  })
})

/** Just enough of a view: a state that moves when it is told to. */
function viewOver(state: EditorState): Pick<EditorView, 'state' | 'dispatch'> {
  const view = {
    state,
    dispatch: (tr: Transaction) => {
      view.state = view.state.apply(tr)
    },
  }
  return view
}

describe('trimming it when the double click is done', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shrinks the selection after the browser has made it, and not before', () => {
    vi.useFakeTimers()
    const view = viewOver(selected('Say something clever.\n', 5, 15))

    trimAfterDoubleClick(view)
    expect(words(view.state)).toBe('something ')
    vi.runAllTimers()

    expect(words(view.state)).toBe('something')
  })

  it('leaves the selection alone when it has none to trim', () => {
    vi.useFakeTimers()
    const before = selected('Say something clever.\n', 5, 14)
    const view = viewOver(before)

    trimAfterDoubleClick(view)
    vi.runAllTimers()

    expect(view.state).toBe(before)
  })

  it('is what the editor does on a double click, which it otherwise leaves to the browser', () => {
    vi.useFakeTimers()
    const view = viewOver(selected('Say something clever.\n', 5, 15))
    const { handleDoubleClick } = createWordSelectionPlugin().props

    const handled = handleDoubleClick?.call(
      undefined as never,
      view as EditorView,
      6,
      new MouseEvent('dblclick'),
    )
    vi.runAllTimers()

    expect(handled).toBe(false)
    expect(words(view.state)).toBe('something')
  })
})
