import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import {
  createHeldSelectionPlugin,
  heldSelectionKey,
  holdSelectionMeta,
  releaseSelectionMeta,
} from './held-selection.ts'

const harness = createEditorTestHarness()

function opened(): EditorState {
  const state = harness.state('Say something clever.\n')
  return state
    .reconfigure({ plugins: [createHeldSelectionPlugin()] })
    .apply(state.tr.setSelection(TextSelection.create(state.doc, 5, 14)))
}

/** The ranges drawn as held, as text. */
function held(state: EditorState): string[] {
  const set = heldSelectionKey.getState(state)?.decorations
  return (set?.find() ?? []).map((each) => state.doc.textBetween(each.from, each.to))
}

describe('a selection held while something else has the keyboard', () => {
  it('is drawn when it is held, for the range it was held at', () => {
    const state = opened()
    const next = state.apply(holdSelectionMeta(state.tr, { from: 5, to: 14 }))

    expect(held(next)).toEqual(['something'])
  })

  it('is not drawn when nothing is held', () => {
    expect(held(opened())).toEqual([])
  })

  it('is let go of, and nothing is drawn, when it is released', () => {
    const state = opened()
    const holding = state.apply(holdSelectionMeta(state.tr, { from: 5, to: 14 }))
    const next = holding.apply(releaseSelectionMeta(holding.tr))

    expect(held(next)).toEqual([])
  })

  it('stays where the text it marks goes, as the document changes around it', () => {
    const state = opened()
    const holding = state.apply(holdSelectionMeta(state.tr, { from: 5, to: 14 }))
    const next = holding.apply(holding.tr.insertText('Well, ', 1))

    expect(held(next)).toEqual(['something'])
  })

  it('draws nothing for a range that is only a point', () => {
    const state = opened()
    const next = state.apply(holdSelectionMeta(state.tr, { from: 5, to: 5 }))

    expect(held(next)).toEqual([])
  })
})
