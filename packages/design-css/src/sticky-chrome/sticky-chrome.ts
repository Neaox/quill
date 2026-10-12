/**
 * The page's sticky chrome, as one number every sticky thing below it reads.
 *
 * `--sticky-chrome-top` is how far down the viewport the page's own sticky
 * bars reach: a table's hanging header stops there (ADR-040), and an anchor
 * target lands just below it (`--anchor-offset` is derived from it). Each
 * shell sets it once, from its own bar. Where the bar's height is a token,
 * as the application's is (`--spacing-shell-header`), the stylesheet says so
 * and nothing runs. Where it is not — the public site's header wraps onto a
 * second line when its menu folds on a narrow screen — this keeps it equal
 * to the bar as the bar changes. `--sticky-chrome-bottom` is its twin for
 * the foot of the page, the safe-area inset by default.
 */

export const STICKY_CHROME_TOP = '--sticky-chrome-top'

/** The ResizeObserver this needs, injected so it can be tested without a browser. */
export type ResizeObserverClass = new (callback: () => void) => {
  observe(target: Element): void
  disconnect(): void
}

/**
 * Keeps `--sticky-chrome-top` on `target` equal to `bar`'s height, which,
 * for a bar stuck to the top of the page, is how far down it reaches.
 * Returns what stops it and takes the value away. Without a bar, nothing.
 */
export function trackStickyChrome(
  bar: Element | null,
  target: HTMLElement,
  Observer: ResizeObserverClass | undefined = target.ownerDocument.defaultView?.ResizeObserver,
): () => void {
  if (bar === null) return () => undefined
  const measure = (): void => {
    target.style.setProperty(STICKY_CHROME_TOP, `${bar.getBoundingClientRect().height}px`)
  }
  measure()
  const observer = Observer === undefined ? undefined : new Observer(measure)
  observer?.observe(bar)
  return () => {
    observer?.disconnect()
    target.style.removeProperty(STICKY_CHROME_TOP)
  }
}
