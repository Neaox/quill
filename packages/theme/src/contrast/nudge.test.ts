import { describe, expect, it } from 'vitest'
import type { Colour } from '../colour/oklch.ts'
import { nudgeLightnessUntil } from './nudge.ts'

const start: Colour = { lightness: 50, chroma: 0.12, hue: 25 }

describe('nudgeLightnessUntil', () => {
  it('changes nothing when the predicate already holds', () => {
    const result = nudgeLightnessUntil(start, () => true)
    expect(result).toEqual({ colour: start, passed: true })
  })

  it('keeps hue and chroma while it moves', () => {
    const result = nudgeLightnessUntil(start, (candidate) => candidate.lightness <= 40)
    expect(result.colour.hue).toBe(start.hue)
    expect(result.colour.chroma).toBe(start.chroma)
  })

  it('reports the adjustment it made', () => {
    const result = nudgeLightnessUntil(start, (candidate) => candidate.lightness <= 40, {
      step: 2,
    })
    expect(result.adjustment).toEqual({ from: 50, to: 40, delta: -10 })
  })

  it('takes the smaller change when either direction would do', () => {
    const result = nudgeLightnessUntil(
      start,
      (candidate) => candidate.lightness <= 45 || candidate.lightness >= 52,
      { step: 1 },
    )
    expect(result.colour.lightness).toBe(52)
  })

  it('keeps the darker candidate when that is the smaller change', () => {
    const result = nudgeLightnessUntil(
      start,
      (candidate) => candidate.lightness <= 48 || candidate.lightness >= 55,
      { step: 1 },
    )
    expect(result.colour.lightness).toBe(48)
  })

  it('honours a forced direction even when the other way is nearer', () => {
    const result = nudgeLightnessUntil(
      start,
      (candidate) => candidate.lightness <= 45 || candidate.lightness >= 52,
      { step: 1, direction: 'darker' },
    )
    expect(result.colour.lightness).toBe(45)
  })

  it('only lightens when told to', () => {
    const result = nudgeLightnessUntil(start, (candidate) => candidate.lightness >= 60, {
      step: 5,
      direction: 'lighter',
    })
    expect(result.colour.lightness).toBe(60)
  })

  it('stays inside the limits it is given, and says so when nothing passes', () => {
    const result = nudgeLightnessUntil(start, (candidate) => candidate.lightness > 60, {
      maximum: 55,
      minimum: 45,
      step: 1,
    })
    expect(result).toEqual({ colour: start, passed: false })
  })
})
