import { describe, expect, it } from 'vitest'

import { borderAt, dropIndex, proportionsOf, resized, tracksOf, widthFor } from './table-handles.ts'

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
  })

  it('writes widths as whole-per-cent proportions', () => {
    expect(proportionsOf([150, 150, 300])).toBe('25fr 25fr 50fr')
    expect(proportionsOf([1, 999])).toBe('1fr 100fr')
  })
})

describe('dragging a row or column', () => {
  const starts = [0, 40, 80, 120]

  it('lands on the line the dragged line’s middle is over', () => {
    expect(dropIndex(starts, -10)).toBe(0)
    expect(dropIndex(starts, 30)).toBe(0)
    expect(dropIndex(starts, 61)).toBe(1)
    expect(dropIndex(starts, 300)).toBe(3)
  })

  it('stays where it is until the middle crosses into another line, either way', () => {
    // A line 40 tall at 80 has its middle at 100: a nudge either way is not a move.
    expect(dropIndex(starts, 100)).toBe(2)
    expect(dropIndex(starts, 95)).toBe(2)
    expect(dropIndex(starts, 125)).toBe(3)
    expect(dropIndex(starts, 79)).toBe(1)
  })

  it('reads lines of different heights by where they start', () => {
    expect(dropIndex([0, 20, 100], 99)).toBe(1)
    expect(dropIndex([0, 20, 100], 100)).toBe(2)
  })
})

describe('the "+" borders', () => {
  const lines = [
    { start: 0, size: 40 },
    { start: 40, size: 60 },
  ]

  it('sits at a line’s leading edge, and at the last line’s trailing edge after it', () => {
    expect(borderAt(lines, 0)).toBe(0)
    expect(borderAt(lines, 1)).toBe(40)
    expect(borderAt(lines, 2)).toBe(100)
    expect(borderAt([], 0)).toBe(0)
  })
})
