/**
 * Scrolling a slide taller than its window, and where the next slide starts (ADR-050).
 *
 * A slide is usually one screen, and then nothing here does anything. A section taller than its
 * window scrolls, and everything that moves up and down has to treat that as one long surface
 * made of slides laid end to end: scrolling forward at the bottom of a slide arrives at the top of
 * the next, scrolling back at the top of a slide arrives at the bottom of the previous, and a key
 * that goes to a slide as such (left, right, Home, End, a click on the rail) arrives at its top.
 */

import type { ScrollDirection, ScrollDistance, SlideEntry } from './present-state.ts'

const LINE_PIXELS = 48
/** A page scrolls a little less than the window, so the last line you read is still in view. */
const PAGE_FRACTION = 0.9
/**
 * How near an end counts as being at it. The browser rounds the sizes it reports to whole pixels,
 * and a scaled slide (the presenter's) rounds them differently from where it stops, so a slide
 * that has reached its end can read a pixel or two short of it, and would otherwise never step on.
 */
const SLACK = 2

/**
 * What scrolls the slide being shown: the live slide in a presenter window, which scrolls inside
 * itself, and otherwise the page, which is what scrolls in the window the room sees.
 */
export function slideScroller(): Element | null {
  return (
    document.querySelector('[data-live="true"] > .present-step') ??
    // (A document with no layout, as in a test, has none at all rather than `null`.)
    document.scrollingElement ??
    null
  )
}

const furthest = (scroller: Element): number =>
  Math.max(0, scroller.scrollHeight - scroller.clientHeight)

/** Whether there is more of the slide to scroll to in that direction. */
export function canScroll(scroller: Element, direction: ScrollDirection): boolean {
  return direction === 'forward'
    ? scroller.scrollTop < furthest(scroller) - SLACK
    : scroller.scrollTop > SLACK
}

/** Scrolls the slide, and says whether it did; when it could not, the key's other meaning is the step. */
export function scrollSlide(
  scroller: Element | null,
  direction: ScrollDirection,
  distance: ScrollDistance,
): boolean {
  if (scroller === null || !canScroll(scroller, direction)) return false
  const travel = distance === 'page' ? scroller.clientHeight * PAGE_FRACTION : LINE_PIXELS
  scroller.scrollTop += direction === 'forward' ? travel : -travel
  return true
}

/** How long a slide that is still taking its size (a diagram being drawn, a picture loading) is watched. */
const SETTLE_MS = 1500

/**
 * Puts the slide that has just been shown where a person arriving from that side would expect, and
 * returns the way to stop watching it.
 *
 * Arriving at the foot of a slide that is still growing would leave the person partway up it, so a
 * slide entered from below is kept at its foot while it settles, for as long as nobody has moved it
 * (its own position is the way to tell). A slide entered from above is already where it should be.
 */
export function enterSlide(entry: SlideEntry): () => void {
  const scroller = slideScroller()
  if (scroller === null) return () => undefined
  const place = (): number => {
    scroller.scrollTop = entry === 'top' ? 0 : furthest(scroller)
    return scroller.scrollTop
  }
  let placed = place()
  if (entry === 'top') return () => undefined

  const watch = new ResizeObserver(() => {
    if (Math.abs(scroller.scrollTop - placed) < SLACK * 2) placed = place()
  })
  for (const content of scroller.children) watch.observe(content)
  const settled = setTimeout(() => {
    watch.disconnect()
  }, SETTLE_MS)
  return () => {
    clearTimeout(settled)
    watch.disconnect()
  }
}
