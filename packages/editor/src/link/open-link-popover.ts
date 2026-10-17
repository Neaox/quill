import type { EditorView } from '@tiptap/pm/view'

import type { OverlayAnchor, OverlayStore } from '../context-menu/overlay-store.ts'
import { selectionBox } from '../format/selection-box.ts'
import { linkInSelection } from './link-commands.ts'

/**
 * Opens the link popover (Ctrl+K, the toolbar's Link, the menus' Edit link):
 * on the link the caret is in, else on the selected words, else at the caret
 * to make a link with words of its own. Not in code, where a link is text.
 */

/** The words' box on screen, as an anchor. */
export function rangeBox(view: EditorView, from: number, to: number): OverlayAnchor {
  const box = selectionBox(view, from, to)
  return { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top }
}

export function openLinkPopover(view: EditorView, store: OverlayStore): boolean {
  const { state } = view
  const { $from, from, to, empty } = state.selection
  if ($from.parent.type.spec.code === true || !$from.parent.inlineContent) return false
  const link = linkInSelection(state)
  const range = empty && link !== undefined ? link : { from, to }
  store.open({
    kind: 'link',
    anchor: rangeBox(view, range.from, range.to),
    from: range.from,
    to: range.to,
  })
  return true
}
