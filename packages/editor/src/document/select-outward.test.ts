import { AllSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Selection } from '@tiptap/pm/state'
import { CellSelection } from 'prosemirror-tables'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { selectOutward } from './select-outward.ts'

const harness = createEditorTestHarness()
const NL = String.fromCharCode(10)
const lines = (...rows: string[]) => rows.join(NL) + NL

/** A state with the caret just inside the first occurrence of `text`, or around it when `selected`. */
function inside(source: string, text: string, selected = false): EditorState {
  const state = harness.state(source)
  let at = -1
  state.doc.descendants((node, position) => {
    const offset = node.isText ? (node.text ?? '').indexOf(text) : -1
    if (at < 0 && offset >= 0) at = position + offset
  })
  if (at < 0) throw new Error(`No ${text}.`)
  const to = at + (selected ? text.length : 0)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at, to)))
}

/** Presses Select all once, and says what is selected. */
function press(state: EditorState): { state: EditorState; selection: Selection; text: string } {
  let next: EditorState | undefined
  expect(
    selectOutward(state, (tr) => {
      next = state.apply(tr)
    }),
  ).toBe(true)
  const after = next ?? state
  const { from, to } = after.selection
  return { state: after, selection: after.selection, text: after.doc.textBetween(from, to, ' | ') }
}

/** What each press selects, until nothing more is selected. */
function ladder(start: EditorState, presses = 5): readonly string[] {
  const seen: string[] = []
  let state = start
  for (let step = 0; step < presses; step += 1) {
    const result = press(state)
    const kind =
      result.selection instanceof AllSelection
        ? 'everything'
        : result.selection instanceof CellSelection
          ? 'table'
          : result.text
    if (seen.at(-1) === kind) break
    seen.push(kind)
    state = result.state
  }
  return seen
}

describe('Select all, outwards a step at a time', () => {
  it('takes the text of the block the caret is in, then the whole document', () => {
    const doc = lines('First line.', '', 'Second line.')

    expect(ladder(inside(doc, 'ond'))).toEqual(['Second line.', 'everything'])
  })

  it('starts from the block even when part of its text is already selected', () => {
    expect(ladder(inside(lines('One.', '', 'Two words.'), 'words', true))).toEqual([
      'Two words.',
      'everything',
    ])
  })

  it('takes a cell’s text, then the table, then the document', () => {
    const doc = lines('Above.', '', '| One | Two |', '| - | - |', '| a | b |', '', 'Below.')

    expect(ladder(inside(doc, 'Two'))).toEqual(['Two', 'table', 'everything'])
  })

  it('takes a list item, then the whole list, then the document', () => {
    const doc = lines('Before.', '', '- one', '- two', '- three', '', 'After.')

    expect(ladder(inside(doc, 'two'))).toEqual(['two', 'one | two | three', 'everything'])
  })

  it('takes a callout’s paragraph, then all of the callout, then the document', () => {
    const doc = lines('Before.', '', ':::notes', 'First note.', '', 'Second note.', ':::')

    expect(ladder(inside(doc, 'First'))).toEqual([
      'First note.',
      'First note. | Second note.',
      'everything',
    ])
  })

  it('goes straight to the document from an empty block, which has no text to take first', () => {
    const doc = lines('Some words.', '', 'More words.')
    const state = harness.state(doc)
    const empty = state.apply(
      state.tr.insert(0, state.schema.nodes['paragraph']?.create() ?? state.doc),
    )
    const caret = empty.apply(empty.tr.setSelection(TextSelection.create(empty.doc, 1)))

    expect(ladder(caret)).toEqual(['everything'])
  })

  it('spends the key once everything is selected, rather than leaving it to the browser', () => {
    const state = harness.state(lines('One.', '', 'Two.'))
    const all = state.apply(state.tr.setSelection(new AllSelection(state.doc)))

    expect(selectOutward(all)).toBe(true)
    expect(selectOutward(all, () => expect.unreachable('nothing is left to select'))).toBe(true)
  })

  it('says it would run without running', () => {
    expect(selectOutward(inside(lines('One.'), 'On'))).toBe(true)
  })
})
