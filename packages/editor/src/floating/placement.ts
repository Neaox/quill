/**
 * Where a floating surface goes, as arithmetic.
 *
 * Every popup the writing surface shows — the slash menu, the formatting
 * toolbar, the table and callout tools, the context menu — hangs off a rectangle
 * in the document and has to stay on screen. That is one problem, so it is solved
 * once, here, as a pure function of three measurements. The hook that takes the
 * measurements and writes the result to the element is `use-floating-placement`.
 *
 * Positions are viewport coordinates, for `position: fixed`, which is what lets
 * a popup escape every scroll container between it and the page.
 */

export interface Rect {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export type Side = 'above' | 'below'

export interface PlacementRequest {
  /** What the popup hangs off. */
  readonly anchor: Rect
  /** The popup's natural size, before any height limit is applied. */
  readonly size: Size
  readonly viewport: Size
  /** The side tried first; the other is used when this one cannot hold the popup. */
  readonly prefer?: Side
  /** `start` lines the popup's leading edge up with the anchor; `center` centres it on it. */
  readonly align?: 'start' | 'center'
  /** Space between the anchor and the popup. */
  readonly gap?: number
  /** Space kept between the popup and the edge of the viewport. */
  readonly margin?: number
  /** The tallest the popup ever wants to be, however much room there is. */
  readonly limit?: number
}

export interface Placement {
  readonly top: number
  readonly left: number
  /**
   * The tallest the popup may be here. A popup that does not fit on either side
   * scrolls inside this, which is what keeps its last item reachable.
   */
  readonly maxHeight: number
  readonly side: Side
}

/** A point is a rectangle with no area, which is what a click or a caret is. */
export function pointRect(x: number, y: number): Rect {
  return { top: y, right: x, bottom: y, left: x }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high))
}

export function place({
  anchor,
  size,
  viewport,
  prefer = 'below',
  align = 'start',
  gap = 4,
  margin = 8,
  limit = Number.POSITIVE_INFINITY,
}: PlacementRequest): Placement {
  const wanted = Math.min(size.height, limit)
  const room: Readonly<Record<Side, number>> = {
    below: viewport.height - anchor.bottom - gap - margin,
    above: anchor.top - gap - margin,
  }
  const other: Side = prefer === 'below' ? 'above' : 'below'
  const fits = (candidate: Side): boolean => wanted <= room[candidate]
  // When neither side holds the popup whole, the roomier one loses the least.
  const fallback: Side = room[other] > room[prefer] ? other : prefer
  const side = fits(prefer) ? prefer : fits(other) ? other : fallback

  const maxHeight = Math.max(0, Math.min(room[side], limit))
  const height = Math.min(wanted, maxHeight)
  const top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - height

  const leading = align === 'center' ? (anchor.left + anchor.right - size.width) / 2 : anchor.left
  const left = clamp(leading, margin, Math.max(margin, viewport.width - size.width - margin))

  return { top, left, maxHeight, side }
}
