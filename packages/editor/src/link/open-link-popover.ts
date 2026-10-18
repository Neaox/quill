import type { EditorView } from '@tiptap/pm/view'

import { anchorOf } from '../context-menu/overlay-store.ts'
import type { OverlayAnchor, OverlayStore } from '../context-menu/overlay-store.ts'
import { selectionBox } from '../format/selection-box.ts'
import { linkInSelection } from './link-commands.ts'
import { linkTargetAt } from './link-display.ts'

/**
 * Opens the link popover (Ctrl+K, the toolbar's Link, the menus' Edit link):
 * on the link the caret is in — an ordinary link, an inline `:link` or a
 * selected card — else on the selected words, else at the caret to make a
 * link with words of its own. Not in code, where a link is text.
 */

/** The words' box on screen, as an anchor. */
export function rangeBox(view: EditorView, from: number, to: number): OverlayAnchor {
  const box = selectionBox(view, from, to)
  return { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top }
}

/** A link's box on screen: its words, or the block a card is drawn as. */
export function linkBox(view: EditorView, from: number, to: number): OverlayAnchor {
  const node = view.state.doc.nodeAt(from)
  const block = node?.isBlock === true ? view.nodeDOM(from) : null
  return block instanceof HTMLElement
    ? anchorOf(block.getBoundingClientRect())
    : rangeBox(view, from, to)
}

export function openLinkPopover(view: EditorView, store: OverlayStore): boolean {
  const { state } = view
  const directive = linkTargetAt(state)
  if (directive !== null && directive.form !== 'mark') {
    store.open({
      kind: 'link',
      anchor: linkBox(view, directive.from, directive.to),
      from: directive.from,
      to: directive.to,
    })
    return true
  }
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

/** Opens a card's own title and description (ADR-042), against the card. */
export function openLinkDetails(view: EditorView, store: OverlayStore, pos: number): void {
  store.open({ kind: 'link-details', anchor: linkBox(view, pos, pos), pos })
}
