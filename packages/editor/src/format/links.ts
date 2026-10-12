import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model'
import type { Command, EditorState } from '@tiptap/pm/state'

import { markType } from '../schema/node-type.ts'

/**
 * Editing a link that is already there.
 *
 * `setLink` and `removeLink` act on a selection. A link, though, is something a
 * caret rests *in*: an author who clicks a link word has selected nothing and
 * still means "that link". `linkAt` finds the whole run of text the caret's link
 * covers, so the toolbar can show where it goes and change or remove it without
 * asking the author to select it first.
 */

export interface LinkRun {
  readonly from: number
  readonly to: number
  readonly href: string
  readonly title: string | null
}

interface MarkedRun {
  readonly mark: Mark
  readonly from: number
  readonly to: number
}

/** Every link in a textblock, with neighbouring text that shares one address joined into one run. */
function linkRuns(parent: PMNode, start: number, type: MarkType): readonly MarkedRun[] {
  const runs: MarkedRun[] = []
  let offset = start
  parent.forEach((child) => {
    const from = offset
    offset += child.nodeSize
    const mark = type.isInSet(child.marks)
    if (mark === undefined) return
    const last = runs.at(-1)
    if (last !== undefined && last.to === from && mark.eq(last.mark)) {
      runs[runs.length - 1] = { ...last, to: offset }
    } else {
      runs.push({ mark, from, to: offset })
    }
  })
  return runs
}

/**
 * The link under the caret or, for a selection, the link that covers all of it.
 *
 * A caret at either end of a link is outside it, because that is where typing
 * would put new text: a link does not grow when you type after it.
 */
export function linkAt(state: EditorState): LinkRun | null {
  const { $from, from, to, empty } = state.selection
  const run = linkRuns($from.parent, $from.start(), markType(state.schema, 'link')).find(
    (candidate) =>
      empty
        ? candidate.from < from && from < candidate.to
        : candidate.from <= from && to <= candidate.to,
  )
  if (run === undefined) return null
  const { href, title } = run.mark.attrs
  return {
    from: run.from,
    to: run.to,
    href: typeof href === 'string' ? href : '',
    title: typeof title === 'string' ? title : null,
  }
}

/** The text a link would be applied to: the selection, or the link the caret is in. */
function linkRange(state: EditorState): { from: number; to: number } | null {
  const { from, to, empty } = state.selection
  if (!empty) return { from, to }
  return linkAt(state)
}

/** Points the selection, or the link the caret is in, at `href`. */
export function applyLink(href: string): Command {
  return (state, dispatch) => {
    const range = linkRange(state)
    if (range === null) return false
    const type = markType(state.schema, 'link')
    dispatch?.(
      state.tr
        .removeMark(range.from, range.to, type)
        .addMark(range.from, range.to, type.create({ href })),
    )
    return true
  }
}

/** Takes the link off the selection, or off the whole link the caret is in. */
export const unlink: Command = (state, dispatch) => {
  const range = linkRange(state)
  if (range === null) return false
  dispatch?.(state.tr.removeMark(range.from, range.to, markType(state.schema, 'link')))
  return true
}
