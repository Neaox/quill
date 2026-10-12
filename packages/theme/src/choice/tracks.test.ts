import { describe, expect, it } from 'vitest'

import { chromaTrack, hueTrack } from './tracks.ts'

const stopsOf = (gradient: string): readonly string[] =>
  gradient
    .replace(/^linear-gradient\(to right, /u, '')
    .replace(/\)$/u, '')
    .split(/, (?=oklch)/u)

describe('hueTrack', () => {
  it('runs round the whole wheel at the choice’s strength', () => {
    const stops = stopsOf(hueTrack({ hue: 184, chroma: 0.1 }))
    expect(stops).toHaveLength(13)
    expect(stops[0]).toBe('oklch(55% 0.1 0)')
    expect(stops.at(-1)).toBe('oklch(55% 0.1 360)')
  })
})

describe('chromaTrack', () => {
  it('runs from grey to the maximum at the choice’s hue and lightness', () => {
    const stops = stopsOf(chromaTrack({ hue: 184, chroma: 0.1, lightness: 40 }, 0.06))
    expect(stops).toHaveLength(7)
    expect(stops[0]).toBe('oklch(40% 0 184)')
    expect(stops.at(-1)).toBe('oklch(40% 0.06 184)')
  })
})
