import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { documentToMdast } from './ast.ts'
import { moveBlock } from './move-block.ts'

const harness = createEditorTestHarness()
const NL = String.fromCharCode(10)
const lines = (...rows: string[]) => rows.join(NL) + NL

/** A state with the caret `into` characters into the first occurrence of `text`. */
function inside(source: string, text: string, into = 0): EditorState {
  const state = harness.state(source)
  let at = -1
  state.doc.descendants((node, position) => {
    const offset = node.isText ? (node.text ?? '').indexOf(text) : -1
    if (at < 0 && offset >= 0) at = position + offset
  })
  if (at < 0) throw new Error(`No ${text}.`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at + into)))
}

/** The Markdown after the block is moved, and the text the caret is still in. */
function moved(state: EditorState, by: -1 | 1) {
  let next: EditorState | undefined
  const ran = moveBlock(by)(state, (tr) => {
    next = state.apply(tr)
  })
  if (!ran || next === undefined) return undefined
  return {
    markdown: harness.read(documentToMdast(next.doc).tree),
    caretIn: next.selection.$from.parent.textContent,
    offset: next.selection.$from.parentOffset,
  }
}

describe('moving a block with the keyboard', () => {
  const DOC = lines('First.', '', 'Second.', '', 'Third.')

  it('swaps a paragraph with the one after it, and the caret goes with its words', () => {
    expect(moved(inside(DOC, 'Second', 3), 1)).toEqual({
      markdown: lines('First.', '', 'Third.', '', 'Second.'),
      caretIn: 'Second.',
      offset: 3,
    })
  })

  it('swaps it with the one before', () => {
    expect(moved(inside(DOC, 'Second'), -1)?.markdown).toBe(
      lines('Second.', '', 'First.', '', 'Third.'),
    )
  })

  it('stays put at the first and last block, and says so by declining', () => {
    expect(moved(inside(DOC, 'First'), -1)).toBeUndefined()
    expect(moved(inside(DOC, 'Third'), 1)).toBeUndefined()
  })

  it('moves a list item whole, with what is nested in it, within its list', () => {
    const list = lines('- one', '  - nested', '- two', '- three')

    expect(moved(inside(list, 'one'), 1)?.markdown).toBe(
      lines('- two', '- one', '  - nested', '- three'),
    )
    expect(moved(inside(list, 'nested'), -1)).toBeUndefined()
  })

  it('moves a list item whole even from a second paragraph of it', () => {
    const list = lines('- one', '', '  more', '', '- two')

    expect(moved(inside(list, 'more'), 1)?.markdown).toBe(lines('- two', '', '- one', '', '  more'))
  })

  it('moves a paragraph within the callout it is in, and no further', () => {
    const doc = lines(':::notes', 'First note.', '', 'Second note.', ':::', '', 'After.')

    expect(moved(inside(doc, 'First'), 1)?.markdown).toBe(
      lines(':::notes', 'Second note.', '', 'First note.', ':::', '', 'After.'),
    )
    expect(moved(inside(doc, 'Second'), 1)).toBeUndefined()
  })

  it('leaves a table cell to the table’s own row and column moves', () => {
    const table = lines('| One | Two |', '| - | - |', '| a | b |')

    expect(moved(inside(table, 'One'), 1)).toBeUndefined()
  })

  it('leaves a selection that spans blocks alone', () => {
    const state = harness.state(DOC)
    const spanning = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 12)))

    expect(moved(spanning, 1)).toBeUndefined()
  })

  it('declines where the caret is between blocks, not in any', () => {
    const state = harness.state(DOC)
    const between = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 0)))

    expect(moved(between, 1)).toBeUndefined()
  })

  it('leaves a selected block, which is not a caret in a line of text, to the key', () => {
    const state = harness.state(DOC)
    const chosen = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))

    expect(moved(chosen, 1)).toBeUndefined()
  })

  it('says it would run without running', () => {
    expect(moveBlock(1)(inside(DOC, 'Second'))).toBe(true)
  })
})
