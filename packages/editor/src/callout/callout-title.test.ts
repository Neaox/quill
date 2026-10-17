import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { nodeType } from '../schema/node-type.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { calloutAt, labelParagraph } from './callout.ts'
import {
  backspaceInCalloutTitle,
  createCalloutTitlePlugin,
  deleteInCalloutTitle,
  enterInCalloutTitle,
} from './callout-title.ts'

const harness = createEditorTestHarness()

const UNTITLED = ':::callout{type=tip}\nMind the gap.\n:::\n'
const TITLED = ':::callout[Before you begin]{type=tip}\nMind the gap.\n:::\n'
const TITLE_ONLY = ':::callout[Just a title]{type=tip}\n:::\n'

/** A caret `offset` characters into the first text containing `needle`. */
function caretIn(markdown: string, needle: string, offset = 1): EditorState {
  const opened = harness.state(markdown)
  let found = -1
  opened.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(needle) === true) found = pos + offset
  })
  return opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, found)))
}

function written(state: EditorState): string {
  return harness.read(documentToMdast(state.doc).tree)
}

function transactionOf(command: Command, state: EditorState): Transaction | undefined {
  const built: Transaction[] = []
  command(state, (tr) => {
    built.push(tr)
  })
  return built.at(0)
}

function apply(command: Command, state: EditorState): EditorState {
  const tr = transactionOf(command, state)
  if (tr === undefined) throw new Error('The command declined.')
  return state.apply(tr)
}

function declines(command: Command, state: EditorState): boolean {
  return transactionOf(command, state) === undefined
}

/** The text of the block the caret is in. */
function caretBlock(state: EditorState): string {
  return state.selection.$from.parent.textContent
}

/** An empty title put first in the callout the caret is in, with the caret in it. */
function withEmptyTitle(state: EditorState): EditorState {
  const callout = calloutAt(state)
  if (callout === undefined) throw new Error('No callout.')
  const tr = state.tr.insert(
    callout.pos + 1,
    nodeType(state.schema, 'paragraph').create({ directiveLabel: true }),
  )
  return state.apply(tr.setSelection(TextSelection.create(tr.doc, callout.pos + 2)))
}

function bodyStart(state: EditorState): number {
  let body = -1
  state.doc.descendants((node, pos) => {
    if (body < 0 && node.isText && node.text === 'Mind the gap.') body = pos + 1
  })
  return body
}

describe('the keys in a callout’s title', () => {
  it('Enter goes on to the body, wherever in the title the caret is, and makes no new title', () => {
    for (const offset of [0, 6, 'Before you begin'.length]) {
      const state = apply(enterInCalloutTitle, caretIn(TITLED, 'Before', offset))

      expect(caretBlock(state)).toBe('Mind the gap.')
      expect(state.selection.$from.parentOffset).toBe(0)
      expect(calloutAt(state)?.node.childCount).toBe(2)
    }
  })

  it('Enter makes a body to go on to when the title is all there is', () => {
    const state = apply(enterInCalloutTitle, caretIn(TITLE_ONLY, 'Just'))

    expect(calloutAt(state)?.node.childCount).toBe(2)
    expect(caretBlock(state)).toBe('')
    expect(state.selection.$from.parent.attrs['directiveLabel']).toBeFalsy()
  })

  it('Enter replaces a range selected in the title as it goes on', () => {
    const opened = harness.state(TITLED)
    let from = -1
    opened.doc.descendants((node, pos) => {
      if (from < 0 && node.isText && node.text === 'Before you begin') from = pos
    })
    const ranged = opened.apply(
      opened.tr.setSelection(TextSelection.create(opened.doc, from + 7, from + 11)),
    )

    const state = apply(enterInCalloutTitle, ranged)

    expect(labelParagraph(calloutAt(state)?.node ?? state.doc)?.textContent).toBe('Before begin')
    expect(caretBlock(state)).toBe('Mind the gap.')
  })

  it('leaves Enter to everything else outside a title', () => {
    expect(declines(enterInCalloutTitle, caretIn(TITLED, 'Mind'))).toBe(true)
    expect(declines(enterInCalloutTitle, caretIn('Just text.\n', 'Just'))).toBe(true)
    expect(declines(enterInCalloutTitle, caretIn('> [!TIP]\n> Mind the gap.\n', 'Mind'))).toBe(true)
  })

  it('Backspace at the start of an empty title takes the title away', () => {
    const state = apply(backspaceInCalloutTitle, withEmptyTitle(caretIn(UNTITLED, 'Mind')))

    expect(calloutAt(state)?.node.firstChild?.attrs['directiveLabel']).toBeFalsy()
    expect(caretBlock(state)).toBe('Mind the gap.')
  })

  it('Backspace at the start of a title with words keeps them, and goes nowhere', () => {
    const state = caretIn(TITLED, 'Before', 0)

    // Handled, so the browser does not join the title to what is before the callout.
    expect(backspaceInCalloutTitle(state)).toBe(true)
    expect(written(state)).toContain('[Before you begin]')
  })

  it('leaves Backspace to everything else', () => {
    expect(declines(backspaceInCalloutTitle, caretIn(TITLED, 'Before', 3))).toBe(true)
    expect(declines(backspaceInCalloutTitle, caretIn(TITLED, 'Mind', 0))).toBe(true)
    expect(declines(backspaceInCalloutTitle, caretIn('Just text.\n', 'Just', 0))).toBe(true)
  })

  it('Delete at the end of a title does not draw the body into it', () => {
    expect(deleteInCalloutTitle(caretIn(TITLED, 'Before', 'Before you begin'.length))).toBe(true)
    expect(deleteInCalloutTitle(caretIn(TITLED, 'Before', 3))).toBe(false)
    expect(deleteInCalloutTitle(caretIn(TITLED, 'Mind', 13))).toBe(false)
  })
})

function withPlugin(state: EditorState): EditorState {
  return state.reconfigure({ plugins: [createCalloutTitlePlugin()] })
}

describe('a title left empty', () => {
  it('stays while the caret is in it, so it can be typed into', () => {
    const state = withEmptyTitle(withPlugin(caretIn(UNTITLED, 'Mind')))

    expect(calloutAt(state)?.node.firstChild?.attrs['directiveLabel']).toBe(true)
  })

  it('goes when the caret leaves it, because a callout with an empty title has no title', () => {
    let state = withEmptyTitle(withPlugin(caretIn(UNTITLED, 'Mind')))
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, bodyStart(state))))

    expect(calloutAt(state)?.node.childCount).toBe(1)
    expect(written(state)).toBe(UNTITLED)
    expect(caretBlock(state)).toBe('Mind the gap.')
  })

  it('stays, with its words, when the caret leaves a title that has some', () => {
    let state = withPlugin(caretIn(TITLED, 'Before'))
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, bodyStart(state))))

    expect(written(state)).toContain('[Before you begin]')
  })

  it('stays while something else changes and the caret is still in it', () => {
    let state = withEmptyTitle(withPlugin(caretIn(UNTITLED, 'Mind')))
    state = state.apply(state.tr.insertText('Careful. ', bodyStart(state) - 1))

    expect(calloutAt(state)?.node.firstChild?.attrs['directiveLabel']).toBe(true)
  })

  it('leaves a body to write in when the title was all the callout had', () => {
    const state = withPlugin(caretIn(':::callout[Only]{type=tip}\n:::\n\nAfter.\n', 'Only', 0))
    let title = -1
    let after = -1
    state.doc.descendants((node, pos) => {
      if (title < 0 && node.isText && node.text === 'Only') title = pos
      if (after < 0 && node.isText && node.text === 'After.') after = pos + 1
    })
    const emptied = state.apply(state.tr.delete(title, title + 4))
    const left = emptied.apply(
      emptied.tr.setSelection(TextSelection.create(emptied.doc, after - 4)),
    )

    const callout = left.doc.firstChild
    expect(callout?.childCount).toBe(1)
    expect(callout?.firstChild?.attrs['directiveLabel']).toBeFalsy()
  })

  it('is not looked for when the selection never was in a callout', () => {
    const state = withPlugin(caretIn('Just text. And more.\n', 'Just'))
    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)))

    expect(written(moved)).toBe('Just text. And more.\n')
  })
})
