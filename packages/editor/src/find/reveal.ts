/**
 * Bringing a match into view when the keyboard is in the find bar.
 *
 * ProseMirror scrolls the selection into view only when its own DOM selection is the browser's, and
 * with the caret in the bar it is not, so stepping to a match it selected would leave it off screen.
 * This does it instead: if the match is not clear of the bar and above the bottom edge it is brought
 * to the middle of the page, as VS Code does, and otherwise the page stays where it is, so a match
 * already in view does not make the document jump.
 */

/** What is asked of an editor view: where a position is drawn, and what element it is in. */
export interface RevealView {
  coordsAtPos(position: number): { readonly top: number; readonly bottom: number }
  domAtPos(position: number): { readonly node: Node }
}

export function revealPosition(
  view: RevealView,
  position: number,
  /** The page position of the bottom of the bar, which a match behind is not seen. */
  clearTop: number,
  /** The height of what is shown of the page. */
  viewportHeight: number,
): void {
  let rect: ReturnType<RevealView['coordsAtPos']>
  try {
    rect = view.coordsAtPos(position)
  } catch {
    // A view with no layout, a test without one, has nothing to measure and nowhere to scroll.
    return
  }
  if (rect.top >= clearTop && rect.bottom <= viewportHeight) return
  const { node } = view.domAtPos(position)
  const element = node instanceof Element ? node : node.parentElement
  element?.scrollIntoView({ block: 'center', inline: 'nearest' })
}
