/**
 * Bringing a match into view when the keyboard is in the find bar.
 *
 * ProseMirror scrolls the selection into view only when its own DOM selection is the browser's, and
 * with the caret in the bar it is not, so stepping to a match it selected would leave it off screen.
 * This does it instead: if the match is not clear of the bar and above the bottom edge it is brought
 * to the middle of the page, as VS Code does, and otherwise the page stays where it is, so a match
 * already in view does not make the document jump.
 *
 * Blocks off screen are not laid out (`content-visibility: auto`, `packages/ui/src/styles/editor.css`):
 * each stands at a remembered or guessed height, and where a position inside one is drawn is not
 * known until it is drawn. So the match's top-level block is scrolled to first, which has the
 * browser draw it and its neighbours at their real heights; in the next frame, with the layout
 * settled, the match itself is measured again and centred if it is still not in view.
 */

/** What is asked of an editor view: where a position is drawn, what element it is in, and the root. */
export interface RevealView {
  readonly dom: Element
  coordsAtPos(position: number): { readonly top: number; readonly bottom: number }
  domAtPos(position: number): { readonly node: Node }
}

/** Calls back once the layout has caught up with a scroll: the next animation frame. */
export type NextFrame = (callback: () => void) => void

const animationFrame: NextFrame = (callback) => {
  requestAnimationFrame(() => {
    callback()
  })
}

const CENTRED: ScrollIntoViewOptions = { block: 'center', inline: 'nearest' }

/** Whether the position is drawn clear of the bar and above the bottom edge; undefined with no layout to ask. */
function inView(
  view: RevealView,
  position: number,
  clearTop: number,
  viewportHeight: number,
): boolean | undefined {
  try {
    const rect = view.coordsAtPos(position)
    return rect.top >= clearTop && rect.bottom <= viewportHeight
  } catch {
    // A view with no layout, a test without one, has nothing to measure and nowhere to scroll.
    return undefined
  }
}

/** The element a position is in, and the top-level block that element is in. */
function placeOf(view: RevealView, position: number) {
  const { node } = view.domAtPos(position)
  const element = node instanceof Element ? node : node.parentElement
  let block = element
  while (block !== null && block.parentElement !== view.dom) block = block.parentElement
  return { element, block: block ?? element }
}

export function revealPosition(
  view: RevealView,
  position: number,
  /** The page position of the bottom of the bar, which a match behind is not seen. */
  clearTop: number,
  /** The height of what is shown of the page. */
  viewportHeight: number,
  nextFrame: NextFrame = animationFrame,
): void {
  if (inView(view, position, clearTop, viewportHeight) !== false) return
  const { element, block } = placeOf(view, position)
  if (element === null || block === null) return
  // Drawn, the block and those beside it take their real heights and the page settles.
  block.scrollIntoView(CENTRED)
  nextFrame(() => {
    if (inView(view, position, clearTop, viewportHeight) === false) element.scrollIntoView(CENTRED)
  })
}
