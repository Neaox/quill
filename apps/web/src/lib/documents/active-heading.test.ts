import { describe, expect, it } from 'vitest'

import { activeHeading, positionOf } from './active-heading.ts'
import type { BandPosition } from './active-heading.ts'

const entry = (isIntersecting: boolean, top: number, bandTop: number | null = 0) => ({
  isIntersecting,
  boundingClientRect: { top },
  rootBounds: bandTop === null ? null : { top: bandTop },
})

describe('where a heading is relative to the reading band', () => {
  it('is in the band while it is crossing it', () => {
    expect(positionOf(entry(true, 50))).toBe('in')
  })

  it('is above the band once it has gone past the top of it', () => {
    expect(positionOf(entry(false, -20))).toBe('above')
    expect(positionOf(entry(false, 10, 80))).toBe('above')
  })

  it('is below the band before it has arrived', () => {
    expect(positionOf(entry(false, 600))).toBe('below')
    expect(positionOf(entry(false, 0))).toBe('below')
  })

  it('reads the band as starting at the top of the page when the browser does not say', () => {
    expect(positionOf(entry(false, -5, null))).toBe('above')
    expect(positionOf(entry(false, 5, null))).toBe('below')
  })
})

describe('which heading is current', () => {
  const ids = ['a', 'b', 'c', 'd']
  const at = (...positions: BandPosition[]) =>
    new Map(ids.map((id, index) => [id, positions[index] ?? 'below'] as const))

  it('is none before the first heading has been reached', () => {
    expect(activeHeading(ids, at('below', 'below', 'below', 'below'))).toBeUndefined()
    expect(activeHeading(ids, new Map())).toBeUndefined()
  })

  it('is the heading in the band', () => {
    expect(activeHeading(ids, at('above', 'in', 'below', 'below'))).toBe('b')
  })

  it('is the first of two that are both in the band', () => {
    expect(activeHeading(ids, at('above', 'in', 'in', 'below'))).toBe('b')
  })

  it('is the last one passed when none is in the band, which is the section being read', () => {
    expect(activeHeading(ids, at('above', 'above', 'below', 'below'))).toBe('b')
    expect(activeHeading(ids, at('above', 'above', 'above', 'above'))).toBe('d')
  })

  it('goes back up as the reader scrolls back up: the heading that slides below is not current', () => {
    // Reading "c"; scroll up until "c" leaves the band by the bottom edge.
    expect(activeHeading(ids, at('above', 'above', 'in', 'below'))).toBe('c')
    expect(activeHeading(ids, at('above', 'above', 'below', 'below'))).toBe('b')
  })
})
