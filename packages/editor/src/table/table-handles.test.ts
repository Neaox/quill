import { describe, expect, it } from 'vitest'

import {
  boundaries,
  dropIndex,
  proportionsOf,
  resized,
  tracksOf,
  widthFor,
} from './table-handles.ts'

describe('the width handle', () => {
  const tracks = { content: 680, wide: 960, full: 1280 }

  it('reads the grid’s three widths from its tracks', () => {
    expect(tracksOf('100px 140px 680px 140px 220px')).toEqual(tracks)
    expect(tracksOf('none')).toBeUndefined()
  })

  it('snaps to the content, wide and full tracks, and is a share of the full one between', () => {
    expect(widthFor(690, tracks)).toEqual({ value: 'content', label: 'Content' })
    expect(widthFor(950, tracks)).toEqual({ value: undefined, label: 'Wide' })
    expect(widthFor(1270, tracks)).toEqual({ value: 'full', label: 'Full' })
    expect(widthFor(1100, tracks)).toEqual({ value: '85%', label: '85%' })
    expect(widthFor(10, tracks)).toEqual({ value: '5%', label: '5%' })
  })
})

describe('the column borders', () => {
  it('moves the border between two columns, keeping each at least a minimum wide', () => {
    expect(resized([100, 200, 300], 0, 50)).toEqual([150, 150, 300])
    expect(resized([100, 200, 300], 1, 500)).toEqual([100, 460, 40])
    expect(resized([100, 200, 300], 0, -500)).toEqual([40, 260, 300])
    expect(resized([100], 0, 50)).toEqual([60])
    expect(resized([], 0, 50)).toEqual([])
  })

  it('leaves every width as it was for a border the table does not have', () => {
    expect(resized([100, 200], 5, 50)).toEqual([100, 200])
  })

  it('writes widths as whole-per-cent proportions', () => {
    expect(proportionsOf([150, 150, 300])).toBe('25fr 25fr 50fr')
    expect(proportionsOf([1, 999])).toBe('1fr 100fr')
  })
})

describe('dragging a row or column', () => {
  it('lands on the line whose middle the pointer passed last', () => {
    const extents = [0, 40, 80, 120].map((start) => ({ start, size: 40 }))

    expect(dropIndex(extents, -10)).toBe(0)
    expect(dropIndex(extents, 30)).toBe(0)
    expect(dropIndex(extents, 61)).toBe(1)
    expect(dropIndex(extents, 300)).toBe(3)
  })
})

describe('the inserting "+"s', () => {
  it('stand at every line’s start and after the last', () => {
    expect(
      boundaries([
        { start: 0, size: 40 },
        { start: 40, size: 60 },
      ]),
    ).toEqual([0, 40, 100])
    expect(boundaries([])).toEqual([0])
  })
})
