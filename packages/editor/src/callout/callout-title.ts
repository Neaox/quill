import { Extension } from '@tiptap/core'
import { keymap } from '@tiptap/pm/keymap'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, Selection, TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'

import { nodeType } from '../schema/node-type.ts'
import { calloutAt } from './callouts.ts'

/**
 * A callout's title: the `[Title]` of `:::callout[Title]{type=tip}`.
 *
 * In the document it is the callout's first paragraph, marked as its label. On
 * the page it is the callout's heading, in the label type beside the variant's
 * icon, and a callout without one is headed by the variant's name. So it is
 * something the author adds, edits and removes, and every one of those is a
 * command on that first paragraph; the rest of the callout is never touched.
 *
 * A title is a line of its own, not a paragraph to write several in: Enter goes
 * on to the body, and nothing joins the body into it or the title into
 * whatever is before the callout.
 */

/** A callout's title paragraph, or undefined when it has none. */
export function calloutTitleOf(callout: PMNode): PMNode | undefined {
  const first = callout.firstChild
  return first?.type.name === 'paragraph' && first.attrs['directiveLabel'] === true
    ? first
    : undefined
}

interface TitleHere {
  readonly callout: { readonly pos: number; readonly node: PMNode }
  /** The position before the title paragraph. */
  readonly pos: number
  readonly node: PMNode
}

/** The title the caret is in, or undefined when it is anywhere else. */
function titleAt(state: EditorState): TitleHere | undefined {
  const callout = calloutAt(state)
  const node = callout === null ? undefined : calloutTitleOf(callout.node)
  if (callout === null || node === undefined) return undefined
  const pos = callout.pos + 1
  const { from } = state.selection
  return from > pos && from < pos + node.nodeSize ? { callout, pos, node } : undefined
}

/** Puts an empty title first, with the caret in it, ready to type. */
export const addCalloutTitle: Command = (state, dispatch) => {
  const callout = calloutAt(state)
  if (callout === null || calloutTitleOf(callout.node) !== undefined) return false
  if (dispatch === undefined) return true
  const tr = state.tr.insert(
    callout.pos + 1,
    nodeType(state.schema, 'paragraph').create({ directiveLabel: true }),
  )
  dispatch(tr.setSelection(TextSelection.create(tr.doc, callout.pos + 2)).scrollIntoView())
  return true
}

/**
 * Takes the title away and goes to the body. When the title was all the callout
 * had, an empty paragraph is left in its place, because a callout needs a body.
 */
export const removeCalloutTitle: Command = (state, dispatch) => {
  const callout = calloutAt(state)
  const title = callout === null ? undefined : calloutTitleOf(callout.node)
  if (callout === null || title === undefined) return false
  if (dispatch === undefined) return true
  const pos = callout.pos + 1
  const tr = state.tr
  if (callout.node.childCount === 1) {
    tr.replaceWith(pos, pos + title.nodeSize, nodeType(state.schema, 'paragraph').create())
    tr.setSelection(TextSelection.create(tr.doc, pos + 1))
  } else {
    tr.delete(pos, pos + title.nodeSize)
    tr.setSelection(Selection.near(tr.doc.resolve(pos), 1))
  }
  dispatch(tr.scrollIntoView())
  return true
}

/** Adds a title where there is none, and removes the one there is. */
export const toggleCalloutTitle: Command = (state, dispatch, view) => {
  const callout = calloutAt(state)
  if (callout === null) return false
  const command = calloutTitleOf(callout.node) === undefined ? addCalloutTitle : removeCalloutTitle
  return command(state, dispatch, view)
}

/** Enter in the title: on to the body, making one when the title is all the callout has. */
export const enterInCalloutTitle: Command = (state, dispatch) => {
  const here = titleAt(state)
  if (here === undefined) return false
  if (dispatch === undefined) return true
  const tr = state.tr
  if (!state.selection.empty) tr.deleteSelection()
  const title = tr.doc.nodeAt(here.pos)
  const callout = tr.doc.nodeAt(here.callout.pos)
  /* v8 ignore next -- the title and its callout are where they were. */
  if (title === null || callout === null) return false
  const after = here.pos + title.nodeSize
  if (after >= here.callout.pos + callout.nodeSize - 1) {
    tr.insert(after, nodeType(state.schema, 'paragraph').create())
  }
  dispatch(tr.setSelection(Selection.near(tr.doc.resolve(after), 1)).scrollIntoView())
  return true
}

/**
 * Backspace at the start of the title: an empty title is taken away, as the
 * author asking to be rid of it; one with words stays, and the key does nothing,
 * rather than joining it to whatever is before the callout.
 */
export const backspaceInCalloutTitle: Command = (state, dispatch, view) => {
  const here = titleAt(state)
  if (here === undefined || !state.selection.empty || state.selection.$from.parentOffset !== 0) {
    return false
  }
  return here.node.content.size === 0 ? removeCalloutTitle(state, dispatch, view) : true
}

/** Delete at the end of the title: nothing, rather than drawing the body up into it. */
export const deleteInCalloutTitle: Command = (state) => {
  const here = titleAt(state)
  const { selection } = state
  return (
    here !== undefined &&
    selection.empty &&
    selection.$from.parentOffset === selection.$from.parent.content.size
  )
}

/** An empty title in the callout the state's selection is in, where its caret is. */
function emptyTitleAt(state: EditorState): TitleHere | undefined {
  const here = titleAt(state)
  return here?.node.content.size === 0 ? here : undefined
}

/**
 * A title left empty is no title: when the caret leaves one, it is taken away,
 * so an author who added one and thought better of it is not left with a callout
 * that says `[]`. While the caret is in it, it stays, to be typed into.
 */
export function createCalloutTitlePlugin(): Plugin {
  return new Plugin({
    appendTransaction: (transactions, oldState, newState) => {
      if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null
      const before = emptyTitleAt(oldState)
      if (before === undefined) return null
      const pos = transactions.reduce((mapped, tr) => tr.mapping.map(mapped), before.pos)
      const title = newState.doc.nodeAt(pos)
      if (title === null || title.type.name !== 'paragraph' || title.content.size > 0) return null
      const { from } = newState.selection
      if (from > pos && from < pos + title.nodeSize) return null
      const callout = newState.doc.resolve(pos).parent
      const tr = newState.tr
      if (callout.childCount === 1) {
        tr.replaceWith(pos, pos + title.nodeSize, nodeType(newState.schema, 'paragraph').create())
      } else {
        tr.delete(pos, pos + title.nodeSize)
      }
      return tr
    },
  })
}

/** The title's plugin and its keys, ahead of the keys they would otherwise be. */
export const CalloutTitle = Extension.create({
  name: 'calloutTitle',
  priority: 1000,
  addProseMirrorPlugins: () => [
    createCalloutTitlePlugin(),
    keymap({
      Enter: enterInCalloutTitle,
      Backspace: backspaceInCalloutTitle,
      Delete: deleteInCalloutTitle,
    }),
  ],
})
