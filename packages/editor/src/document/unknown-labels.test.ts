import { Editor } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { buildExtensions } from './extensions.ts'
import { unknownLabelDecorations, unknownLabelsKey, UNKNOWN_LABELS } from './unknown-labels.ts'

const harness = createEditorTestHarness()
const LABELS: ReadonlySet<string> = new Set(['airbnb', 'booking'])

function warningsIn(markdown: string): readonly string[] {
  const { doc } = harness.state(markdown)
  return unknownLabelDecorations(doc, LABELS)
    .find()
    .flatMap((decoration) => {
      const spec: unknown = decoration.spec
      return typeof spec === 'object' && spec !== null && 'warning' in spec
        ? [String(spec.warning)]
        : []
    })
}

/** Where the directive with this name starts. */
function directive(state: EditorState, name: string): number {
  let found = -1
  state.doc.descendants((node, position) => {
    if (found < 0 && node.type.name === 'textDirective' && node.attrs['name'] === name) {
      found = position
    }
  })
  if (found < 0) throw new Error(`No :${name} directive in the document.`)
  return found
}

function paragraphWith(state: EditorState, markdown: string) {
  return state.schema.nodeFromJSON(harness.state(`${markdown}\n`).doc.child(0).toJSON())
}

function pluginSet(state: EditorState): DecorationSet {
  const set = unknownLabelsKey.getState(state)
  if (set === undefined) throw new Error('No unknown-label decorations.')
  return set
}

const widths = (set: DecorationSet) =>
  set
    .find()
    .map((decoration) => [decoration.from, decoration.to])
    .toSorted(([a = 0, b = 0], [c = 0, d = 0]) => a - c || b - d)

const named = (extensions: ReturnType<typeof buildExtensions>) =>
  extensions.map((extension) => extension.name)

describe('unknown labels in the editor (ADR-037)', () => {
  it('warns about a labelled directive that is neither built in nor a label', () => {
    expect(warningsIn('Sold on :airbn[Airbnb] and :expedia[Expedia].\n')).toEqual([
      'Unknown label “airbn”; it will show as written. Did you mean airbnb?',
      'Unknown label “expedia”; it will show as written.',
    ])
  })

  it('says nothing about a label, a built-in, or a directive with no words', () => {
    expect(warningsIn('On :airbnb[Airbnb], :ok[Built], :kbd[Esc] and status:ok.\n')).toEqual([])
  })

  it('marks the directive and says why in words, not by underline alone', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({ labels: [...LABELS] }),
      content: harness.state('On :airbn[Airbnb].\n').doc.toJSON(),
    })
    const warning = 'Unknown label “airbn”; it will show as written. Did you mean airbnb?'
    const marked = editor.view.dom.querySelector('[data-unknown-label="true"]')
    expect(marked?.getAttribute('title')).toBe(warning)
    expect(marked?.textContent).toBe('Airbnb')
    expect(editor.view.dom.querySelector('.sr-only')?.textContent).toBe(` (${warning})`)
    editor.destroy()
  })

  it('computes a document’s warnings once', () => {
    const { doc } = harness.state('On :airbn[Airbnb].\n')
    expect(unknownLabelDecorations(doc, LABELS)).toBe(unknownLabelDecorations(doc, LABELS))
  })

  it('keeps its warnings right while the document is edited, block by block', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({ labels: [...LABELS] }),
      content: harness
        .state(['On :airbnb[Airbnb].', 'And :booking[Booking].', 'Plain.', ''].join('\n\n'))
        .doc.toJSON(),
    })
    const shown = (state: EditorState) => widths(pluginSet(state))
    const expected = (state: EditorState) => widths(unknownLabelDecorations(state.doc, LABELS))
    const edits: ((state: EditorState) => Transaction)[] = [
      // A typo in the first label's name, words typed into the second, then
      // a typo in its name too.
      (state) => state.tr.setNodeAttribute(directive(state, 'airbnb'), 'name', 'airbn'),
      (state) => state.tr.insertText('x', directive(state, 'booking') + 1),
      (state) => state.tr.setNodeAttribute(directive(state, 'booking'), 'name', 'bookin'),
      // A new paragraph with an unknown label, and the old first one gone.
      (state) => state.tr.insert(state.doc.content.size, paragraphWith(state, 'Also :vrbo[Vrbo].')),
      (state) => state.tr.delete(0, state.doc.child(0).nodeSize),
    ]
    for (const edit of edits) {
      editor.view.dispatch(edit(editor.state))
      expect(shown(editor.state)).toEqual(expected(editor.state))
    }
    expect(shown(editor.state)).toHaveLength(4)
    editor.destroy()
  })

  it('keeps the words beside a warning as typing goes on around it', () => {
    // Drawn again, the words are taken out of the paragraph and put back on
    // every keystroke, which lays the page out twice a key (section 31).
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: buildExtensions({ labels: [...LABELS] }),
      content: harness.state('On :airbn[Airbnb] today.\n').doc.toJSON(),
    })
    const words = editor.view.dom.querySelector('.sr-only')
    editor.view.dispatch(editor.state.tr.insertText('x', 2))
    editor.view.dispatch(editor.state.tr.insertText('y', editor.state.doc.content.size - 1))
    expect(editor.view.dom.querySelector('.sr-only')).toBe(words)
    editor.destroy()
  })

  it('runs only in an editor told the organisation’s labels', () => {
    expect(named(buildExtensions())).not.toContain(UNKNOWN_LABELS)
    expect(named(buildExtensions({ labels: ['airbnb'] }))).toContain(UNKNOWN_LABELS)
  })
})
