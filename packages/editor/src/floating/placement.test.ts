import { describe, expect, it } from 'vitest'

import { place, pointRect } from './placement.ts'

const viewport = { width: 1000, height: 800 }
const popup = { width: 200, height: 300 }

describe('placing a popup', () => {
  it('hangs below the anchor when there is room', () => {
    const anchor = { top: 100, right: 150, bottom: 120, left: 100 }
    expect(place({ anchor, size: popup, viewport })).toEqual({
      top: 124,
      left: 100,
      maxHeight: 668,
      side: 'below',
    })
  })

  it('flips above when the bottom of the viewport cannot hold it', () => {
    const anchor = { top: 600, right: 150, bottom: 620, left: 100 }
    const placement = place({ anchor, size: popup, viewport })
    expect(placement.side).toBe('above')
    expect(placement.top).toBe(600 - 4 - 300)
    expect(placement.maxHeight).toBe(588)
  })

  it('honours the side it was asked to prefer, and flips from that one', () => {
    const roomy = { top: 400, right: 150, bottom: 420, left: 100 }
    expect(place({ anchor: roomy, size: popup, viewport, prefer: 'above' }).side).toBe('above')
    const nearTop = { top: 100, right: 150, bottom: 120, left: 100 }
    expect(place({ anchor: nearTop, size: popup, viewport, prefer: 'above' }).side).toBe('below')
  })

  it('limits its height to the roomier side when it fits on neither, so it can scroll', () => {
    const tall = { width: 200, height: 900 }
    const anchor = { top: 500, right: 150, bottom: 520, left: 100 }
    const placement = place({ anchor, size: tall, viewport })
    // 800 - 520 - 4 - 8 = 268 below; 500 - 4 - 8 = 488 above.
    expect(placement).toMatchObject({ side: 'above', maxHeight: 488, top: 500 - 4 - 488 })
  })

  it('keeps the preferred side when it is the roomier of two that do not fit', () => {
    const tall = { width: 200, height: 900 }
    const anchor = { top: 200, right: 150, bottom: 220, left: 100 }
    expect(place({ anchor, size: tall, viewport }).side).toBe('below')
  })

  it('never grows past its own limit, and decides on the height it will have', () => {
    const anchor = { top: 600, right: 150, bottom: 620, left: 100 }
    // 300 tall would not fit below (172 left), but 150 does.
    expect(place({ anchor, size: popup, viewport, limit: 150 })).toMatchObject({
      side: 'below',
      maxHeight: 150,
    })
  })

  it('never has a negative height', () => {
    const anchor = { top: 0, right: 10, bottom: 800, left: 0 }
    expect(place({ anchor, size: popup, viewport }).maxHeight).toBe(0)
  })

  it('centres on the anchor and stays inside the viewport', () => {
    const anchor = { top: 100, right: 500, bottom: 120, left: 300 }
    expect(place({ anchor, size: popup, viewport, align: 'center' }).left).toBe(300)
    const atEdge = { top: 100, right: 20, bottom: 120, left: 0 }
    expect(place({ anchor: atEdge, size: popup, viewport, align: 'center' }).left).toBe(8)
  })

  it('is pulled back from the trailing edge', () => {
    const anchor = { top: 100, right: 990, bottom: 120, left: 950 }
    expect(place({ anchor, size: popup, viewport }).left).toBe(1000 - 200 - 8)
  })

  it('sits at the margin when it is wider than the viewport', () => {
    const anchor = { top: 100, right: 150, bottom: 120, left: 100 }
    expect(place({ anchor, size: { width: 2000, height: 50 }, viewport }).left).toBe(8)
  })

  it('treats a point as an anchor with no area', () => {
    expect(pointRect(10, 20)).toEqual({ top: 20, right: 10, bottom: 20, left: 10 })
    expect(place({ anchor: pointRect(10, 20), size: popup, viewport }).top).toBe(24)
  })
})
