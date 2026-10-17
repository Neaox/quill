import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'

import { findMatches } from './find-matches.ts'
import type { FoundMatch } from './find-matches.ts'
import { replacementFor } from './find-pattern.ts'
import { findKey, findStateOf } from './find-plugin.ts'
import type { FindAction, FindField, FindPatch } from './find-state.ts'

export type { FindPatch } from './find-state.ts'

/**
 * What can be done with find, each a ProseMirror command: one transaction, so one step of undo,
 * and the same behaviour for the bar's buttons, the keyboard and a test.
 */

/** A command that tells the plugin something, and does nothing in an editor without find. */
function act(action: FindAction): Command {
  return (state, dispatch) => {
    if (findStateOf(state) === undefined) return false
    dispatch?.(state.tr.setMeta(findKey, action))
    return true
  }
}

/**
 * Opens find. What is selected, if it is on one line, becomes what is looked for, as in VS Code;
 * with nothing selected the last query is kept.
 */
export function openFind(replacing: boolean): Command {
  return (state, dispatch) => {
    const { from, to, empty, $from, $to } = state.selection
    const picked = !empty && $from.sameParent($to) ? state.doc.textBetween(from, to) : undefined
    return act({ type: 'open', replacing, ...(picked === undefined ? {} : { query: picked }) })(
      state,
      dispatch,
    )
  }
}

/** Shows find again, from inside the bar: the query stays what it was, and `field` takes the keyboard. */
export const showFind = (field: FindField): Command => act({ type: 'show', field })

export const closeFind: Command = act({ type: 'close' })

export const editFind = (patch: FindPatch): Command => act({ type: 'edit', patch })

/** The transaction that selects a match and brings it into view: find's own move, not the writer's. */
function selecting(state: EditorState, match: FoundMatch): Transaction {
  return state.tr
    .setSelection(TextSelection.create(state.doc, match.from, match.to))
    .setMeta(findKey, { type: 'step' })
    .scrollIntoView()
}

/** Steps to the match after the selection, or before it, and round at either end. */
function step(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const matches = findStateOf(state)?.found.matches ?? []
    const { from, to } = state.selection
    const target =
      direction === 1
        ? (matches.find((match) => match.from >= to) ?? matches[0])
        : (matches.findLast((match) => match.to <= from) ?? matches.at(-1))
    if (target === undefined) return false
    dispatch?.(selecting(state, target))
    return true
  }
}

export const findNext: Command = step(1)
export const findPrevious: Command = step(-1)

/**
 * Replaces the match that is selected and goes on to the next. With none selected it only selects
 * the next one, so the first press shows what is about to be replaced.
 */
export const replaceCurrent: Command = (state, dispatch) => {
  const find = findStateOf(state)
  if (find === undefined) return false
  const match = find.found.matches[find.current]
  if (match === undefined) return findNext(state, dispatch)
  if (dispatch !== undefined) {
    const text = replacementFor(match.captured, find.replacement, find.settings)
    const tr = state.tr.insertText(text, match.from, match.to)
    tr.setSelection(TextSelection.create(tr.doc, match.from + text.length))
    dispatch(tr.setMeta(findKey, { type: 'advance' }))
  }
  return true
}

/** Replaces every match, from the last to the first so each keeps its place, as one step. */
export const replaceAll: Command = (state, dispatch) => {
  const find = findStateOf(state)
  if (find?.pattern.kind !== 'ok') return false
  // Every match, however many: the count the bar shows stops at a limit, a replacement must not.
  const { matches } = findMatches(
    state.doc,
    find.pattern,
    find.settings.inSelection ? find.scope : undefined,
    Number.POSITIVE_INFINITY,
  )
  if (matches.length === 0) return false
  if (dispatch !== undefined) {
    const tr = state.tr
    for (const match of matches.toReversed()) {
      tr.insertText(
        replacementFor(match.captured, find.replacement, find.settings),
        match.from,
        match.to,
      )
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}
