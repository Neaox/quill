import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { selectNextOccurrence } from './select-next-occurrence.ts'

const harness = createEditorTestHarness()
const NL = String.fromCharCode(10)
const lines = (...rows: string[]) => rows.join(NL) + NL

/** A state whose selection is `length` characters from `into` characters into the `nth` occurrence of `text`. */
function selected(source: string, text: string, into = 0, length = 0, nth = 0): EditorState {
  const state = harness.state(source)
  const seen: number[] = []
  state.doc.descendants((node, position) => {
    if (!node.isText) return
    let offset = (node.text ?? '').indexOf(text)
    while (offset >= 0) {
      seen.push(position + offset)
      offset = (node.text ?? '').indexOf(text, offset + 1)
    }
  })
  const at = seen[nth]
  if (at === undefined) throw new Error(`No ${text} number ${String(nth)}.`)
  const anchor = at + into
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, anchor, anchor + length)),
  )
}

/** The text selected after Select next occurrence, and the position it starts at; undefined if it declined. */
function next(state: EditorState) {
  let after: EditorState | undefined
  if (!selectNextOccurrence(state, (tr) => (after = state.apply(tr)))) return undefined
  const { from, to } = (after ?? state).selection
  return { text: state.doc.textBetween(from, to), from }
}

describe('selecting the next occurrence', () => {
  const DOC = lines(
    'Ship the plan.',
    '',
    'The plan is to ship it, then plan again.',
    '',
    'Shipping is not ship.',
  )

  it('takes the word the caret is in, from anywhere in it', () => {
    expect(next(selected(DOC, 'plan', 2))?.text).toBe('plan')
    expect(next(selected(DOC, 'plan', 0))?.text).toBe('plan')
  })

  it('takes the word the caret has just come to the end of', () => {
    expect(next(selected(DOC, 'plan', 4))?.text).toBe('plan')
  })

  it('goes on to the next time the selected words come, in the next block as well', () => {
    const first = selected(DOC, 'plan', 0, 4, 0)
    const second = next(first)
    const third = next(selected(DOC, 'plan', 0, 4, 1))

    expect(second?.from).toBeGreaterThan(first.selection.to)
    expect(third?.from).toBeGreaterThan(second?.from ?? 0)
  })

  it('wraps from the last one to the first', () => {
    const last = selected(DOC, 'plan', 0, 4, 2)

    expect(next(last)?.from).toBe(selected(DOC, 'plan', 0, 4, 0).selection.from)
  })

  it('matches whole words, so ship is not found in shipping', () => {
    const shipped = next(selected(DOC, 'ship', 0, 4, 0))
    const after = next(selected(DOC, 'ship', 0, 4, 1))

    expect(
      selected(DOC, 'Shipping').doc.textBetween(shipped?.from ?? 0, (shipped?.from ?? 0) + 4),
    ).toBe('ship')
    expect(after?.text).toBe('ship')
  })

  it('matches any text that is not a word as it is, spaces and all', () => {
    const doc = lines('To be or not to be.', '', 'Whether to be, or not.')

    expect(next(selected(doc, 'to be', 0, 5, 0))?.from).toBeGreaterThan(8)
  })

  it('stays on the only one there is', () => {
    const only = selected(lines('A unique word.'), 'unique', 0, 6)

    expect(next(only)?.from).toBe(only.selection.from)
  })

  it('declines beside no word, and for a selection that runs across blocks', () => {
    expect(next(selected(DOC, '.', 1))).toBeUndefined()
    const state = harness.state(DOC)
    const across = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 20)))
    expect(next(across)).toBeUndefined()
  })

  it('finds the word beside an image, and leaves a selected block to the key', () => {
    const beside = harness.state('plan![alt](/x.png) and more' + NL)
    const caret = beside.apply(beside.tr.setSelection(TextSelection.create(beside.doc, 3)))
    expect(next(caret)?.text).toBe('plan')

    const block = harness.state(DOC)
    const chosen = block.apply(block.tr.setSelection(NodeSelection.create(block.doc, 0)))
    expect(next(chosen)).toBeUndefined()
  })

  it('takes the word in the first piece of a line that goes on in another mark', () => {
    const state = harness.state('plan **bold** words' + NL)
    const caret = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)))

    expect(next(caret)?.text).toBe('plan')
  })

  it('says it would run without running', () => {
    expect(selectNextOccurrence(selected(DOC, 'plan', 1))).toBe(true)
  })
})
