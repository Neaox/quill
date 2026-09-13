/**
 * The two layout measurements that exist in CSS and are also needed in
 * JavaScript, declared once so they cannot drift (review 2026-09-13, L4: the
 * shell's bar height had four different values across the stylesheets, a
 * scroll margin, an observer's root margin, and a specimen class).
 *
 * CSS is the source: `styles/tokens.css` declares `--spacing-shell-header` and
 * derives `--anchor-offset` from it, and every rule and utility reads those.
 * These constants exist only for the one caller that cannot — an
 * `IntersectionObserver`'s `rootMargin`, which is a string of pixels computed
 * before any element is measured. `metrics.test.ts` reads the stylesheet and
 * fails if either declaration stops agreeing with the number here.
 */

/** `--spacing-shell-header`: the height of the document shell's header bar. */
export const SHELL_HEADER_HEIGHT_PX = 40

/**
 * `--anchor-offset`: where a heading lands when it is scrolled to, and so
 * where "being read" begins — the bar's height plus one step of air.
 *
 * The CSS derives the air from `--spacing`, which a comfortable density
 * loosens; this is the value at the tuned (compact) baseline. That is exact
 * for the scroll margin and near enough for the observer, whose job is to
 * decide which of several headings is nearest a band, not to resolve a pixel.
 */
export const ANCHOR_OFFSET_PX = 56
