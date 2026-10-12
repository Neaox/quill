import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject, UIEvent } from 'react'

/**
 * Drawing only the rows of a list that can be seen (AGENTS.md rule 13:
 * virtualise long lists).
 *
 * The slash menu can hold a hundred items once extensions contribute theirs,
 * and it is drawn again on every keystroke; drawing the dozen in view keeps a
 * keystroke inside a frame however long the catalogue grows. Rows have fixed
 * heights, so where each one sits is a sum rather than a measurement, and
 * the arithmetic is pure and tested on its own.
 */

function sum(heights: readonly number[]): number {
  return heights.reduce((total, height) => total + height, 0)
}

export interface RowWindow {
  /** The first row drawn. */
  readonly start: number
  /** One past the last row drawn. */
  readonly end: number
  /** The height of the rows above the window, kept as space. */
  readonly before: number
  /** The height of the rows below it. */
  readonly after: number
}

/** How many rows are drawn beyond each edge, so a fast scroll does not show a gap. */
const OVERSCAN = 4

/**
 * The rows that are in view at a scroll position, with a few to spare either
 * side. `padding` is the space the list keeps above its first row and below its
 * last, which the scroll position counts and the rows' heights do not.
 */
export function windowOf(
  heights: readonly number[],
  scrollTop: number,
  viewport: number,
  padding = 0,
): RowWindow {
  const rows = heights.length
  let first = rows
  let last = rows
  let offset = padding
  for (const [row, height] of heights.entries()) {
    if (first === rows && offset + height > scrollTop) first = row
    if (last === rows && offset >= scrollTop + viewport) last = row
    offset += height
  }
  const start = Math.max(0, first - OVERSCAN)
  const end = Math.min(rows, last + OVERSCAN)
  return { start, end, before: sum(heights.slice(0, start)), after: sum(heights.slice(end)) }
}

/**
 * The scroll position that brings rows `first` to `last` fully into view,
 * moving as little as possible: an option with the heading above it, say.
 *
 * Reaching the first row shows the padding above it, and reaching the last shows
 * the padding below it: a list that stopped a few pixels short would leave its
 * ends clipped, which is the one thing a list that scrolls must not do.
 */
export function reveal(
  heights: readonly number[],
  [first, last]: readonly [number, number],
  scrollTop: number,
  viewport: number,
  padding = 0,
): number {
  const top = first === 0 ? 0 : padding + sum(heights.slice(0, first))
  const bottom =
    padding + sum(heights.slice(0, last + 1)) + (last === heights.length - 1 ? padding : 0)
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewport) return bottom - viewport
  return scrollTop
}

export interface WindowedList {
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly window: RowWindow
  onScroll(event: UIEvent<HTMLElement>): void
  /** Scrolls so rows are in view; for the keyboard, never for the pointer. */
  revealRows(first: number, last: number): void
}

export function useWindowedList(
  heights: readonly number[],
  viewport: number,
  padding = 0,
): WindowedList {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)

  // Keeps the list's scroll position — the browser's, an external system —
  // where the keyboard last put it. The browser reports its own scrolling
  // back through `onScroll`, so the two agree without a loop.
  useEffect(() => {
    const list = listRef.current
    if (list !== null && list.scrollTop !== scrollTop) list.scrollTop = scrollTop
  }, [scrollTop])

  const revealRows = useCallback(
    (first: number, last: number) => {
      setScrollTop((current) => reveal(heights, [first, last], current, viewport, padding))
    },
    [heights, viewport, padding],
  )

  return {
    listRef,
    window: windowOf(heights, scrollTop, viewport, padding),
    onScroll: (event) => {
      setScrollTop(event.currentTarget.scrollTop)
    },
    revealRows,
  }
}
