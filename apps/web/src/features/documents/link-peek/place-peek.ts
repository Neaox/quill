/**
 * Where a peek card hangs: below its link, or above when there is no room
 * below, and always inside the window.
 */

export interface Box {
  readonly width: number
  readonly height: number
}

export interface Edges {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface PeekPlacement {
  readonly left: number
  readonly top: number
  readonly side: 'above' | 'below'
}

const GAP = 8
const MARGIN = 16

export function placePeek(anchor: Edges, card: Box, viewport: Box): PeekPlacement {
  const roomBelow = viewport.height - anchor.bottom - GAP - MARGIN
  const roomAbove = anchor.top - GAP - MARGIN
  const above = roomBelow < card.height && roomAbove >= card.height
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - card.width - MARGIN))
  return above
    ? { left, top: anchor.top - GAP - card.height, side: 'above' }
    : { left, top: anchor.bottom + GAP, side: 'below' }
}
