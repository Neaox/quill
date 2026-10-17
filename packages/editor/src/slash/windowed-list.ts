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
 * side. `inset` is the list's own padding above its first row: the rows start
 * that far down what scrolls, so a window worked out without it lags the
 * scroll by that much.
 */
export function windowOf(
  heights: readonly number[],
  scrollTop: number,
  viewport: number,
  inset = 0,
): RowWindow {
  const rows = heights.length
  let first = rows
  let last = rows
  let offset = inset
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
 * The list's padding counts: the first row is revealed with the padding above
 * it and the last with the padding below it, which is what scrolling to either
 * end by hand shows, so the keyboard and the wheel agree on where the end is.
 */
export function reveal(
  heights: readonly number[],
  [first, last]: readonly [number, number],
  scrollTop: number,
  viewport: number,
  inset = 0,
): number {
  const top = first === 0 ? 0 : inset + sum(heights.slice(0, first))
  const bottom = inset + sum(heights.slice(0, last + 1)) + (last === heights.length - 1 ? inset : 0)
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewport) return Math.max(0, bottom - viewport)
  return scrollTop
}

/** Everything the list scrolls through: every row, and its padding at both ends. */
export function scrollHeight(heights: readonly number[], inset = 0): number {
  return sum(heights) + inset * 2
}

export interface WindowedList {
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly window: RowWindow
  onScroll(event: UIEvent<HTMLElement>): void
  /** Scrolls so rows are in view; for the keyboard, never for the pointer. */
  revealRows(first: number, last: number): void
}

/**
 * `viewport` is the height of the list's scrolling box — its own height, inside
 * any border — and `inset` its padding at each end. Both are the list's real
 * geometry: a window or a reveal worked out against a taller box than the one
 * that scrolls leaves the last rows a few pixels short of reachable.
 */
export function useWindowedList(
  heights: readonly number[],
  viewport: number,
  inset = 0,
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
      setScrollTop((current) => reveal(heights, [first, last], current, viewport, inset))
    },
    [heights, viewport, inset],
  )

  return {
    listRef,
    window: windowOf(heights, scrollTop, viewport, inset),
    onScroll: (event) => {
      setScrollTop(event.currentTarget.scrollTop)
    },
    revealRows,
  }
}
