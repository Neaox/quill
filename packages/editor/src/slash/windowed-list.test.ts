import { describe, expect, it } from 'vitest'

import { reveal, scrollHeight, windowOf } from './windowed-list.ts'

const ROWS = Array.from({ length: 30 }, () => 40)

describe('the rows a window draws', () => {
  it('draws the rows in view and four either side, keeping the rest as space', () => {
    expect(windowOf(ROWS, 0, 200)).toEqual({ start: 0, end: 9, before: 0, after: 21 * 40 })
    expect(windowOf(ROWS, 400, 200)).toEqual({ start: 6, end: 19, before: 240, after: 11 * 40 })
  })

  it('draws to the end when the end is in view, and everything in a short list', () => {
    expect(windowOf(ROWS, 1000, 200)).toMatchObject({ end: 30, after: 0 })
    expect(windowOf([40, 40], 0, 200)).toEqual({ start: 0, end: 2, before: 0, after: 0 })
    expect(windowOf([], 0, 200)).toEqual({ start: 0, end: 0, before: 0, after: 0 })
  })
})

describe('bringing a row into view', () => {
  it('scrolls up to a row above, down to a row below, and not at all for one in view', () => {
    expect(reveal(ROWS, [2, 2], 400, 200)).toBe(80)
    expect(reveal(ROWS, [20, 20], 400, 200)).toBe(21 * 40 - 200)
    expect(reveal(ROWS, [11, 11], 400, 200)).toBe(400)
    // A heading and the option under it, together.
    expect(reveal(ROWS, [9, 10], 400, 200)).toBe(360)
  })
})

describe('a list with padding at its ends', () => {
  const INSET = 4

  it('starts its rows below the padding, so the window does not lag the scroll', () => {
    // Row 0 spans 4–44: at 42 it is still in view, two pixels of it.
    expect(windowOf(ROWS, 42, 200, INSET).start).toBe(0)
    expect(windowOf(ROWS, 1000, 200, INSET)).toMatchObject({ end: 30, after: 0 })
  })

  it('reveals the first row with the padding above it, and the last with the padding below', () => {
    expect(reveal(ROWS, [0, 0], 400, 200, INSET)).toBe(0)
    const end = scrollHeight(ROWS, INSET) - 200
    expect(reveal(ROWS, [29, 29], 0, 200, INSET)).toBe(end)
    // A row in the middle comes in flush with the edge it was beyond.
    expect(reveal(ROWS, [10, 10], 0, 200, INSET)).toBe(INSET + 11 * 40 - 200)
    expect(reveal(ROWS, [10, 10], 1000, 200, INSET)).toBe(INSET + 10 * 40)
  })

  it('never asks for a negative scroll, however tall the box', () => {
    expect(reveal([40], [0, 0], 0, 200, INSET)).toBe(0)
  })

  it('scrolls through every row and both paddings', () => {
    expect(scrollHeight(ROWS, INSET)).toBe(30 * 40 + 8)
    expect(scrollHeight([])).toBe(0)
  })
})
