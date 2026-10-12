import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { transactionOf } from '../format/transactions.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { calloutAt } from './callouts.ts'
import {
  addCalloutTitle,
  backspaceInCalloutTitle,
  calloutTitleOf,
  createCalloutTitlePlugin,
  deleteInCalloutTitle,
  enterInCalloutTitle,
  removeCalloutTitle,
  toggleCalloutTitle,
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

function apply(command: Command, state: EditorState): EditorState {
  const tr = transactionOf(command, state)
  if (tr === null) throw new Error('The command declined.')
  return state.apply(tr)
}

function declines(command: Command, state: EditorState): boolean {
  return transactionOf(command, state) === null
}

/** The text of the block the caret is in. */
function caretBlock(state: EditorState): string {
  return state.selection.$from.parent.textContent
}

describe('a callout’s title', () => {
  it('is its first paragraph when that is its label, and nothing otherwise', () => {
    const titled = calloutAt(caretIn(TITLED, 'Mind'))
    const untitled = calloutAt(caretIn(UNTITLED, 'Mind'))

    expect(titled && calloutTitleOf(titled.node)?.textContent).toBe('Before you begin')
    expect(untitled && calloutTitleOf(untitled.node)).toBeUndefined()
  })
})

describe('adding a title', () => {
  it('puts an empty one first, with the caret in it, and leaves the body alone', () => {
    const state = apply(addCalloutTitle, caretIn(UNTITLED, 'Mind'))

    expect(state.selection.empty).toBe(true)
    expect(caretBlock(state)).toBe('')
    expect(state.selection.$from.parent.attrs['directiveLabel']).toBe(true)
    expect(written(state)).toContain('Mind the gap.')
  })

  it('is written as the callout’s label once it has words', () => {
    const state = apply(addCalloutTitle, caretIn(UNTITLED, 'Mind'))
    const typed = state.apply(state.tr.insertText('Heads up'))

    expect(written(typed)).toBe(':::callout[Heads up]{type=tip}\nMind the gap.\n:::\n')
  })

  it('declines a callout that has one, and anywhere that is no callout', () => {
    expect(declines(addCalloutTitle, caretIn(TITLED, 'Mind'))).toBe(true)
    expect(declines(addCalloutTitle, caretIn('Just text.\n', 'Just'))).toBe(true)
  })
})

describe('removing a title', () => {
  it('takes it away and keeps the body, with the caret in the body', () => {
    const state = apply(removeCalloutTitle, caretIn(TITLED, 'Before'))

    expect(written(state)).toBe(':::callout{type=tip}\nMind the gap.\n:::\n')
    expect(caretBlock(state)).toBe('Mind the gap.')
  })

  it('leaves a body to write in when the title was all there was', () => {
    const state = apply(removeCalloutTitle, caretIn(TITLE_ONLY, 'Just'))

    expect(calloutAt(state)?.node.childCount).toBe(1)
    expect(calloutAt(state)?.node.firstChild?.attrs['directiveLabel']).toBeFalsy()
    expect(caretBlock(state)).toBe('')
  })

  it('declines a callout with none, and anywhere that is no callout', () => {
    expect(declines(removeCalloutTitle, caretIn(UNTITLED, 'Mind'))).toBe(true)
    expect(declines(removeCalloutTitle, caretIn('Just text.\n', 'Just'))).toBe(true)
  })
})

describe('adding and removing as one switch', () => {
  it('adds when there is none, and removes when there is one', () => {
    const added = apply(toggleCalloutTitle, caretIn(UNTITLED, 'Mind'))
    expect(calloutAt(added)?.node.firstChild?.attrs['directiveLabel']).toBe(true)

    const removed = apply(toggleCalloutTitle, caretIn(TITLED, 'Before'))
    expect(written(removed)).toBe(':::callout{type=tip}\nMind the gap.\n:::\n')
  })

  it('declines outside a callout', () => {
    expect(declines(toggleCalloutTitle, caretIn('Just text.\n', 'Just'))).toBe(true)
  })
})

describe('the keys in a title', () => {
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

  it('leaves Enter to everything else outside a title', () => {
    expect(declines(enterInCalloutTitle, caretIn(TITLED, 'Mind'))).toBe(true)
    expect(declines(enterInCalloutTitle, caretIn('Just text.\n', 'Just'))).toBe(true)
  })

  it('Backspace at the start of an empty title takes the title away', () => {
    const empty = apply(addCalloutTitle, caretIn(UNTITLED, 'Mind'))
    const state = apply(backspaceInCalloutTitle, empty)

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
    const state = caretIn(TITLED, 'Before', 'Before you begin'.length)

    expect(deleteInCalloutTitle(state)).toBe(true)
    expect(deleteInCalloutTitle(caretIn(TITLED, 'Before', 3))).toBe(false)
    expect(deleteInCalloutTitle(caretIn(TITLED, 'Mind', 13))).toBe(false)
  })
})

describe('asking whether a title key would act', () => {
  it('says so without doing it, for every key that does', () => {
    expect(addCalloutTitle(caretIn(UNTITLED, 'Mind'))).toBe(true)
    expect(removeCalloutTitle(caretIn(TITLED, 'Before'))).toBe(true)
    expect(enterInCalloutTitle(caretIn(TITLED, 'Before'))).toBe(true)
  })

  it('replaces a range selected in the title when Enter goes on to the body', () => {
    const opened = harness.state(TITLED)
    let from = -1
    opened.doc.descendants((node, pos) => {
      if (from < 0 && node.isText && node.text === 'Before you begin') from = pos
    })
    const ranged = opened.apply(
      opened.tr.setSelection(TextSelection.create(opened.doc, from + 7, from + 11)),
    )

    const state = apply(enterInCalloutTitle, ranged)

    expect(calloutTitleOf(calloutAt(state)?.node ?? state.doc)?.textContent).toBe('Before begin')
    expect(caretBlock(state)).toBe('Mind the gap.')
  })
})

describe('a title left empty', () => {
  function withPlugin(source: string, needle: string, offset = 1): EditorState {
    const state = caretIn(source, needle, offset)
    return state.reconfigure({ plugins: [createCalloutTitlePlugin()] })
  }

  it('stays while the caret is in it, so it can be typed into', () => {
    const state = apply(addCalloutTitle, withPlugin(UNTITLED, 'Mind'))

    expect(calloutAt(state)?.node.firstChild?.attrs['directiveLabel']).toBe(true)
  })

  it('goes when the caret leaves it, because a callout with an empty title has no title', () => {
    let state = apply(addCalloutTitle, withPlugin(UNTITLED, 'Mind'))
    let body = -1
    state.doc.descendants((node, pos) => {
      if (body < 0 && node.isText && node.text === 'Mind the gap.') body = pos + 1
    })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, body)))

    expect(calloutAt(state)?.node.childCount).toBe(1)
    expect(written(state)).toBe(':::callout{type=tip}\nMind the gap.\n:::\n')
    expect(caretBlock(state)).toBe('Mind the gap.')
  })

  it('stays, with its words, when the caret leaves a title that has some', () => {
    let state = withPlugin(TITLED, 'Before')
    let body = -1
    state.doc.descendants((node, pos) => {
      if (body < 0 && node.isText && node.text === 'Mind the gap.') body = pos + 1
    })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, body)))

    expect(written(state)).toContain('[Before you begin]')
  })

  it('stays while something else changes and the caret is still in it', () => {
    let state = apply(addCalloutTitle, withPlugin(UNTITLED, 'Mind'))
    let body = -1
    state.doc.descendants((node, pos) => {
      if (body < 0 && node.isText && node.text === 'Mind the gap.') body = pos
    })
    state = state.apply(state.tr.insertText('Careful. ', body))

    expect(calloutAt(state)?.node.firstChild?.attrs['directiveLabel']).toBe(true)
  })

  it('leaves a body to write in when the title was all the callout had', () => {
    const state = withPlugin(':::callout[Only]{type=tip}\n:::\n\nAfter.\n', 'Only', 0)
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
    const state = withPlugin('Just text. And more.\n', 'Just')
    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)))

    expect(written(moved)).toBe('Just text. And more.\n')
  })
})
