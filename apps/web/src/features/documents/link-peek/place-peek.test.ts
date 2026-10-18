import { describe, expect, it } from 'vitest'

import { placePeek } from './place-peek.ts'

const viewport = { width: 1000, height: 800 }
const card = { width: 320, height: 200 }
const rect = (left: number, top: number, width = 100, height = 20) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
})

describe('placePeek', () => {
  it('hangs below the link, starting at its left edge', () => {
    expect(placePeek(rect(100, 100), card, viewport)).toEqual({
      left: 100,
      top: 128,
      side: 'below',
    })
  })

  it('goes above when there is no room below', () => {
    expect(placePeek(rect(100, 700), card, viewport)).toEqual({
      left: 100,
      top: 492,
      side: 'above',
    })
  })

  it('stays inside the window at the right edge', () => {
    expect(placePeek(rect(900, 100), card, viewport).left).toBe(1000 - 320 - 16)
  })

  it('stays inside the window at the left edge', () => {
    expect(placePeek(rect(-40, 100), card, viewport).left).toBe(16)
  })

  it('goes below when there is no room on either side, rather than off the top', () => {
    expect(placePeek(rect(100, 150), card, { width: 1000, height: 300 })).toMatchObject({
      side: 'below',
    })
  })
})
