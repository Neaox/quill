import type { Mark } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'

import { markType } from '../schema/node-type.ts'

/**
 * Links, as the link popover and the link card change them.
 *
 * A link is a mark over words; the commands here find the whole run of
 * words one link covers, give it a new address or new words, and take it off.
 * A link to another Quill document is written `/d/<id>`: by the document's
 * id, never its path, so it survives a rename or a move (AGENTS.md rule 8).
 */

export interface LinkRange {
  readonly from: number
  readonly to: number
  readonly href: string
  readonly text: string
}

function linkMark(marks: readonly Mark[]): Mark | undefined {
  return marks.find((mark) => mark.type.name === 'link')
}

/** The whole link around a position, or undefined when there is none there. */
export function linkAt(state: EditorState, pos: number): LinkRange | undefined {
  const $pos = state.doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.inlineContent) return undefined
  // The link on the character after the position, or — at a link's end — before it.
  const afterMark = linkMark($pos.nodeAfter?.marks ?? [])
  const mark = afterMark ?? linkMark($pos.nodeBefore?.marks ?? [])
  if (mark === undefined) return undefined
  const linked = (index: number): boolean => mark.isInSet(parent.child(index).marks)
  let first = afterMark === undefined ? $pos.index() - 1 : $pos.index()
  let last = first
  while (first > 0 && linked(first - 1)) first -= 1
  while (last < parent.childCount - 1 && linked(last + 1)) last += 1
  let from = $pos.start()
  for (let index = 0; index < first; index += 1) from += parent.child(index).nodeSize
  let to = from
  for (let index = first; index <= last; index += 1) to += parent.child(index).nodeSize
  const href: unknown = mark.attrs['href']
  return {
    from,
    to,
    href: typeof href === 'string' ? href : '',
    text: state.doc.textBetween(from, to, ' ', '￼'),
  }
}

/** The link the selection is in or covers. */
export function linkInSelection(state: EditorState): LinkRange | undefined {
  const { from, to, empty } = state.selection
  const found = linkAt(state, from)
  if (found === undefined) return undefined
  return empty || to <= found.to ? found : undefined
}

export interface LinkChange {
  readonly from: number
  readonly to: number
  readonly href: string
  /** The words the link reads as; when absent, the words already there. */
  readonly text?: string
}

/**
 * Links `from`–`to` to `href`, with new words if given: a link made at a
 * caret has no words yet, and an edited one may change them. One undo step;
 * the caret lands just after the link, so typing goes on outside it.
 */
export function applyLink(change: LinkChange): Command {
  return (state, dispatch) => {
    const href = change.href.trim()
    if (href === '') return false
    const type = markType(state.schema, 'link')
    const current = state.doc.textBetween(change.from, change.to, ' ', '￼')
    const words = change.text === undefined || change.text === '' ? current : change.text
    const text = words === '' ? href : words
    if (dispatch === undefined) return true
    const mark = type.create({ href, title: null })
    const tr = state.tr
    if (text === current) {
      tr.removeMark(change.from, change.to, type).addMark(change.from, change.to, mark)
    } else {
      const marks = state.doc
        .resolve(change.from)
        .marks()
        .filter((each) => each.type !== type)
      tr.replaceWith(change.from, change.to, state.schema.text(text, [...marks, mark]))
    }
    const end = change.from + text.length
    tr.setSelection(TextSelection.create(tr.doc, end)).removeStoredMark(type)
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** Takes a link off its words, which stay. */
export function unlink(from: number, to: number): Command {
  return (state, dispatch) => {
    const type = markType(state.schema, 'link')
    if (!state.doc.rangeHasMark(from, to, type)) return false
    dispatch?.(state.tr.removeMark(from, to, type))
    return true
  }
}

/** A link to a Quill document, by its id. */
export function documentHref(id: string): string {
  return `/d/${id}`
}

/** Whether a link points at a Quill document, and which. */
export function documentIdOf(href: string): string | undefined {
  return /^\/d\/([^/?#]+)/.exec(href)?.[1]
}

/** What a person typed into the address field, as an address: a bare domain gets https. */
export function normaliseHref(typed: string): string {
  const value = typed.trim()
  if (value === '') return ''
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('/') || value.startsWith('#')) {
    return value
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`
  return /^[^\s/]+\.[^\s/]+/.test(value) ? `https://${value}` : value
}
