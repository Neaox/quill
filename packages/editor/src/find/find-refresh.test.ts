import { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { editFind, openFind } from './find-commands.ts'
import { findMatches } from './find-matches.ts'
import type { Found } from './find-matches.ts'
import { compilePattern } from './find-pattern.ts'
import { findDecorations, findKey, findPlugin } from './find-plugin.ts'
import { refindChanged } from './find-refresh.ts'
import type { FindState } from './find-state.ts'

/**
 * Find is looked for again as the document changes, but only where it changed: the matches
 * elsewhere are mapped through the edit, and only the blocks the edit touched are searched again,
 * so a keystroke with the bar open costs one block, not the document (quill-plan.md section 31).
 * Whatever the edit, what is found is what a search from scratch would find.
 */

const harness = createEditorTestHarness()
const NL = String.fromCharCode(10)
const lines = (...rows: string[]) => rows.join(NL + NL) + NL

afterEach(() => {
  vi.restoreAllMocks()
})

function open(source: string): EditorState {
  const state = harness.state(source).reconfigure({ plugins: [findPlugin()] })
  return state.apply(state.tr.setSelection(TextSelection.atStart(state.doc)))
}

function run(state: EditorState, command: Command): EditorState {
  let next: EditorState | undefined
  command(state, (tr) => {
    next = state.apply(tr)
  })
  if (next === undefined) throw new Error('The command declined.')
  return next
}

function searching(source: string, query: string, inSelection?: readonly [number, number]) {
  let state = open(source)
  if (inSelection !== undefined) {
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inSelection[0], inSelection[1])),
    )
  }
  state = run(state, openFind(false))
  return run(
    state,
    editFind({ query, ...(inSelection === undefined ? {} : { options: { inSelection: true } }) }),
  )
}

const find = (state: EditorState): FindState => {
  const found = findKey.getState(state)
  if (found === undefined) throw new Error('No find plugin.')
  return found
}

const positions = (found: Found) => found.matches.map(({ from, to }) => [from, to])

/** What a search from scratch finds in the state's document. */
function fromScratch(state: EditorState): number[][] {
  const { pattern, settings, scope } = find(state)
  if (pattern.kind !== 'ok') return []
  return positions(findMatches(state.doc, pattern, settings.inSelection ? scope : undefined))
}

const drawnMatches = (state: EditorState) =>
  findDecorations(state)
    .find(undefined, undefined, (spec) => spec['find'] === 'match')
    .map(({ from, to }) => [from, to])

const DOC = lines('A plan for the plan.', 'Nothing here.', 'The last plan.')

describe('finding again as the document changes', () => {
  const edits: readonly [string, (state: EditorState) => Transaction][] = [
    ['typing a new match in another block', (state) => state.tr.insertText(' plan', 30)],
    ['typing inside a match, which breaks it', (state) => state.tr.insertText('x', 4)],
    ['typing before every match', (state) => state.tr.insertText('Another ', 1)],
    ['deleting across two blocks', (state) => state.tr.delete(10, 28)],
    ['joining two blocks', (state) => state.tr.join(22)],
    ['deleting everything', (state) => state.tr.delete(0, state.doc.content.size)],
    [
      'two edits in one transaction',
      (state) => state.tr.insertText('plan ', 1).insertText(' plan', 40),
    ],
  ]

  it.each(edits)('finds what a search from scratch finds, %s', (_edit, edit) => {
    const before = searching(DOC, 'plan')
    const after = before.apply(edit(before))

    expect(positions(find(after).found)).toEqual(fromScratch(after))
    expect(drawnMatches(after)).toEqual(fromScratch(after))
  })

  it('keeps finding within the selection it searches, as that moves with the edit', () => {
    const before = searching(DOC, 'plan', [1, 21])
    const after = before.apply(before.tr.insertText(' plan', 2).insertText('plan', 40))

    expect(positions(find(after).found)).toEqual(fromScratch(after))
    expect(find(after).found.matches).toHaveLength(3)
  })

  it('goes on to the next match after one is replaced, without searching again from scratch', () => {
    const before = searching(DOC, 'plan')
    const after = before.apply(
      before.tr.insertText('scheme', 3, 7).setMeta(findKey, { type: 'advance' }),
    )

    expect(positions(find(after).found)).toEqual(fromScratch(after))
  })

  it('does nothing at all while the bar is closed', () => {
    const closed = open(DOC)
    const before = findKey.getState(closed)
    const after = closed.apply(closed.tr.insertText('plan', 1))

    expect(findKey.getState(after)).toBe(before)
  })

  it('walks only the changed block on a keystroke with the bar open, however long the document', () => {
    const long = lines(
      ...Array.from({ length: 400 }, (_, index) => `Line ${String(index)} of the plan.`),
    )
    let state = searching(long, 'plan')
    const middle = Math.floor(state.doc.content.size / 2)
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(middle))))
    let wholeWalks = 0
    const nodesBetween = PMNode.prototype.nodesBetween
    vi.spyOn(PMNode.prototype, 'nodesBetween').mockImplementation(
      function (this: PMNode, from, to, visit, start) {
        if (this.type.name === 'doc' && to - from > this.content.size / 2) wholeWalks += 1
        nodesBetween.call(this, from, to, visit, start)
      },
    )
    for (let typed = 0; typed < 10; typed += 1) state = state.apply(state.tr.insertText('x'))

    expect(wholeWalks).toBe(0)
    expect(find(state).found.matches).toHaveLength(400)
  })

  it('searches again from scratch, to its limit, when the last search stopped at it', () => {
    const pattern = compilePattern('plan', {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      preserveCase: false,
    })
    if (pattern.kind !== 'ok') throw new Error('No pattern.')
    const state = open(DOC)
    const limited = findMatches(state.doc, pattern, undefined, 2)
    expect(limited.truncated).toBe(true)
    // The edit removes a match the limited search had found, so one it never looked for comes in.
    const tr = state.tr.insertText('x', 4)

    const { found, changed } = refindChanged(limited, tr, pattern, undefined, 2)

    expect(changed).toBeUndefined()
    expect(positions(found)).toEqual(positions(findMatches(tr.doc, pattern, undefined, 2)))
  })

  it('stops at its limit when an edit adds matches past it', () => {
    const pattern = compilePattern('plan', {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      preserveCase: false,
    })
    if (pattern.kind !== 'ok') throw new Error('No pattern.')
    const state = open(DOC)
    const all = findMatches(state.doc, pattern, undefined, 4)
    expect(all.truncated).toBe(false)
    const tr = state.tr.insertText('plan plan ', 1)

    const { found } = refindChanged(all, tr, pattern, undefined, 4)

    expect(found.truncated).toBe(true)
    expect(positions(found)).toEqual(positions(findMatches(tr.doc, pattern, undefined, 4)))
  })
})
