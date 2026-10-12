import { closeHistory } from '@tiptap/pm/history'
import type { EditorView } from '@tiptap/pm/view'

import type { SlashItem, SlashPicker, SlashRequest } from './slash-item.ts'

/**
 * Running a chosen item, as one step of the author's history.
 *
 * The typed `/query` is removed, the item acts, and both are one undo: undo
 * takes the block away and gives the query back, as Notion does, so a wrong
 * choice costs one keystroke. The removal starts a new history event (what
 * the author typed before it is its own), the item's change joins it — the
 * history merges a change adjacent to the one before it — and the event is
 * closed afterwards, so what the author types next is undone separately.
 */

export interface SlashRange {
  readonly from: number
  readonly to: number
}

export interface RunSlashItemOptions {
  readonly view: EditorView
  readonly range: SlashRange
  readonly item: SlashItem
  request(request: SlashRequest): void
  pick(picker: SlashPicker): void
}

/**
 * What to remove: the query, and the space before it when the query ends a
 * line and the item puts its block after that line — "Some words /divider"
 * leaves "Some words", not a line ending in a space. An inline item keeps
 * the space, which separates it from the word before.
 */
export function removalRange(view: EditorView, range: SlashRange, item: SlashItem): SlashRange {
  const $to = view.state.doc.resolve(range.to)
  const atLineEnd = $to.parentOffset === $to.parent.content.size
  const before = view.state.doc.textBetween(Math.max($to.start(), range.from - 1), range.from)
  return item.inline !== true && atLineEnd && before === ' '
    ? { from: range.from - 1, to: range.to }
    : range
}

export function runSlashItem({ view, range, item, request, pick }: RunSlashItemOptions): void {
  const removal = removalRange(view, range, item)
  view.dispatch(closeHistory(view.state.tr.delete(removal.from, removal.to)))
  item.run({
    state: view.state,
    dispatch: (transaction) => {
      view.dispatch(transaction)
    },
    request,
    pick,
  })
  view.dispatch(closeHistory(view.state.tr))
}
