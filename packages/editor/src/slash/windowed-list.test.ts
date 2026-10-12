import { describe, expect, it } from 'vitest'

import { reveal, windowOf } from './windowed-list.ts'

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

describe('a list with space above its first row and below its last', () => {
  it('counts the space as part of the scroll position, so rows start after it', () => {
    // 4px of padding: the second row begins at 4 + 40.
    expect(windowOf(ROWS, 0, 200, 4)).toEqual(windowOf(ROWS, 0, 200))
    expect(windowOf(ROWS, 44, 40, 4)).toMatchObject({ start: 0 })
    expect(windowOf(ROWS, 400, 200, 4).before).toBe(windowOf(ROWS, 396, 200).before)
  })

  it('reaches the very end, the padding below the last row included', () => {
    expect(reveal(ROWS, [29, 29], 0, 200, 4)).toBe(4 + 30 * 40 + 4 - 200)
    expect(reveal(ROWS, [29, 29], 0, 200)).toBe(30 * 40 - 200)
  })

  it('reaches the very top, the padding above the first row included', () => {
    expect(reveal(ROWS, [0, 0], 400, 200, 4)).toBe(0)
  })

  it('brings a row in the middle fully into view, with no extra padding to count', () => {
    expect(reveal(ROWS, [20, 20], 400, 200, 4)).toBe(4 + 21 * 40 - 200)
    expect(reveal(ROWS, [11, 11], 400, 200, 4)).toBe(400)
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
