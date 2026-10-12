import { Editor } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { buildExtensions } from '../document/extensions.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { requiredDecorations, requiredSectionsKey } from './required-markers.ts'

const harness = createEditorTestHarness()

const TEMPLATE = [
  '---',
  'template:',
  '  name: Runbook',
  '  version: 1',
  '  sections:',
  '    - heading: Context',
  '      required: true',
  '    - heading: Steps',
  '      required: true',
  '---',
  '',
  '## Context',
  '',
  'Why this runbook exists.',
  '',
  '## Steps',
  '',
  'What to do.',
  '',
].join('\n')

const spans = (state: EditorState, set = requiredSectionsKey.getState(state)) =>
  (set?.find() ?? []).map(({ from, to }) => [from, to])

/** Where the heading with these words starts. */
function heading(state: EditorState, text: string): number {
  let found = -1
  state.doc.forEach((node, offset) => {
    if (node.type.name === 'heading' && node.textContent === text) found = offset
  })
  if (found < 0) throw new Error(`No heading reads “${text}”.`)
  return found
}

describe('the required-section markers while the document is edited', () => {
  it('stay where a full rebuild would put them', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions(),
      content: harness.state(TEMPLATE).doc.toJSON(),
    })
    const edits: ((state: EditorState) => Transaction)[] = [
      // Writing in a body paragraph, then renaming a required heading away
      // from its name and back.
      (state) => state.tr.insertText(' Still.', heading(state, 'Steps') - 1),
      (state) => state.tr.delete(heading(state, 'Steps') + 5, heading(state, 'Steps') + 6),
      (state) => state.tr.insertText('s', heading(state, 'Step') + 5),
      // The front matter itself: the template no longer requires Context.
      (state) => {
        const front = state.doc.child(0)
        const value = String(front.attrs['value']).replace(
          'heading: Context\n      required: true',
          'heading: Context',
        )
        return state.tr.setNodeAttribute(0, 'value', value)
      },
    ]
    expect(spans(editor.state)).toHaveLength(4)
    for (const edit of edits) {
      editor.view.dispatch(edit(editor.state))
      expect(spans(editor.state)).toEqual(
        spans(editor.state, requiredDecorations(editor.state.doc)),
      )
    }
    expect(spans(editor.state)).toHaveLength(2)
    editor.destroy()
  })
})
