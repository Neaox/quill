import type { ResizeObserverClass } from '../sticky-chrome/sticky-chrome.ts'

/**
 * Code that scrolls sideways, reachable by keyboard (WCAG 2.1.1).
 *
 * A `pre` wider than its column scrolls inside itself, and a keyboard can only
 * scroll what it can focus. Chrome now focuses such a scroller on its own;
 * Firefox and Safari do not. So while, and only while, a block overflows, it
 * is a tab stop, a group named for what it is ("TypeScript code, scrolls
 * sideways"), and drawn with the focus ring `prose.css` gives a `pre`. A block
 * that fits is left out of the tab order, where it would be a stop with
 * nothing to do. The server cannot know which blocks overflow, so this is the
 * reader's to decide, as the page is laid out and whenever it is laid out
 * again.
 *
 * A `pre` that already carries a tab index is someone else's (a diagram's
 * source, or a block a later enhancement made focusable) and is left alone.
 */

/** Allows a pixel of sub-pixel rounding before a block counts as scrolling. */
const TOLERANCE = 1

const ATTRIBUTES = ['tabindex', 'role', 'aria-label'] as const

/** Whether this module made `pre` a tab stop, so it only ever undoes its own. */
const MARK = 'scrollRegion'

export function watchScrollingCode(
  root: Element | Document,
  name: (code: Element | null) => string | undefined,
  Observer: ResizeObserverClass | undefined = ('body' in root ? root : root.ownerDocument)
    .defaultView?.ResizeObserver,
): () => void {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre')].filter(
    (pre) => !pre.hasAttribute('tabindex'),
  )
  const release = (pre: HTMLElement): void => {
    if (pre.dataset[MARK] === undefined) return
    for (const attribute of ATTRIBUTES) pre.removeAttribute(attribute)
    delete pre.dataset[MARK]
  }
  const measure = (): void => {
    for (const pre of blocks) {
      if (pre.scrollWidth <= pre.clientWidth + TOLERANCE) {
        release(pre)
        continue
      }
      const language = name(pre.querySelector(':scope > code'))
      pre.tabIndex = 0
      pre.setAttribute('role', 'group')
      const kind = language === undefined ? 'Code' : `${language} code`
      pre.setAttribute('aria-label', `${kind}, scrolls sideways`)
      pre.dataset[MARK] = ''
    }
  }
  measure()
  const observer = Observer === undefined ? undefined : new Observer(measure)
  for (const pre of blocks) observer?.observe(pre)
  return () => {
    observer?.disconnect()
    for (const pre of blocks) release(pre)
  }
}
