import { Extension } from '@tiptap/core'
import { keymap } from '@tiptap/pm/keymap'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, Selection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'

import { nodeType } from '../schema/node-type.ts'
import { calloutAt, labelParagraph } from './callout.ts'
import type { CalloutRef } from './callout.ts'

/**
 * Writing in a callout block's title, the `[Title]` of `:::callout[Title]`.
 *
 * In the document the title is the callout's first paragraph, marked as its
 * label (`labelParagraph`); the menu adds and removes it (`callout-menu.ts`).
 * It is a line of its own, not a paragraph to write several in, so its keys
 * are a title's: Enter goes on to the body, Backspace at the start of an empty
 * one takes it away, and nothing joins the body into it or the title into
 * whatever is before the callout. A title left empty is no title, and goes
 * when the caret leaves it.
 *
 * Every check starts from the selection and climbs to its callout, so a
 * keystroke anywhere costs a few parent lookups and never a document walk.
 */

interface TitleHere {
  readonly callout: CalloutRef
  /** The position before the title paragraph. */
  readonly pos: number
  readonly node: PMNode
}

/** The title the caret is in, or undefined when it is anywhere else. */
function titleAt(state: EditorState): TitleHere | undefined {
  const { from } = state.selection
  const callout = calloutAt(state, from)
  const node = callout === undefined ? undefined : labelParagraph(callout.node)
  if (callout === undefined || node === undefined) return undefined
  const pos = callout.pos + 1
  return from > pos && from < pos + node.nodeSize ? { callout, pos, node } : undefined
}

/**
 * Takes the title the caret is in away and goes to the body. When the title
 * was all the callout had, an empty paragraph is left, as a callout needs a body.
 */
const removeTitleHere: Command = (state, dispatch) => {
  const here = titleAt(state)
  /* v8 ignore next -- only Backspace calls this, once it has found the caret in a title. */
  if (here === undefined) return false
  if (dispatch === undefined) return true
  const { pos, node, callout } = here
  const tr = state.tr
  if (callout.node.childCount === 1) {
    tr.replaceWith(pos, pos + node.nodeSize, nodeType(state.schema, 'paragraph').create())
    tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)))
  } else {
    tr.delete(pos, pos + node.nodeSize)
    tr.setSelection(Selection.near(tr.doc.resolve(pos), 1))
  }
  dispatch(tr.scrollIntoView())
  return true
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
 * author asking to be rid of it; one with words stays and the key does nothing,
 * rather than joining it to whatever is before the callout.
 */
export const backspaceInCalloutTitle: Command = (state, dispatch, view) => {
  const here = titleAt(state)
  if (here === undefined || !state.selection.empty || state.selection.$from.parentOffset !== 0) {
    return false
  }
  return here.node.content.size === 0 ? removeTitleHere(state, dispatch, view) : true
}

/** Delete at the end of the title: nothing, rather than drawing the body up into it. */
export const deleteInCalloutTitle: Command = (state) => {
  const { selection } = state
  return (
    selection.empty &&
    selection.$from.parentOffset === selection.$from.parent.content.size &&
    titleAt(state) !== undefined
  )
}

/**
 * A title left empty is no title: when the caret leaves one, it is taken away,
 * so an author who cleared it is not left with a callout that says `[]`.
 * While the caret is in it, it stays, to be typed into.
 */
export function createCalloutTitlePlugin(): Plugin {
  return new Plugin({
    appendTransaction: (transactions, oldState, newState) => {
      if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null
      const before = titleAt(oldState)
      if (before === undefined || before.node.content.size > 0) return null
      const pos = transactions.reduce((mapped, tr) => tr.mapping.map(mapped), before.pos)
      const title = newState.doc.nodeAt(pos)
      if (title?.type.name !== 'paragraph' || title.content.size > 0) return null
      if (title.attrs['directiveLabel'] !== true) return null
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
  priority: 1010,
  addProseMirrorPlugins: () => [
    createCalloutTitlePlugin(),
    keymap({
      Enter: enterInCalloutTitle,
      Backspace: backspaceInCalloutTitle,
      Delete: deleteInCalloutTitle,
    }),
  ],
})
