import { describe, expect, it } from 'vitest'
import {
  chromaCompensationFactor,
  clampHue,
  compensateChroma,
  hueDistance,
  MAX_CHROMA_COMPENSATION,
  normaliseHue,
  shiftHueAway,
} from './hue.ts'

describe('normaliseHue', () => {
  it('wraps in both directions', () => {
    expect(normaliseHue(370)).toBe(10)
    expect(normaliseHue(-30)).toBe(330)
    expect(normaliseHue(120)).toBe(120)
  })
})

describe('hueDistance', () => {
  it('takes the short way round', () => {
    expect(hueDistance(10, 350)).toBe(20)
    expect(hueDistance(350, 10)).toBe(20)
    expect(hueDistance(25, 85)).toBe(60)
    expect(hueDistance(45, 250)).toBe(155)
  })
})

describe('shiftHueAway', () => {
  it('moves upwards when that is the way away', () => {
    expect(shiftHueAway(30, 25, 10)).toBe(40)
  })

  it('moves downwards when that is the way away', () => {
    expect(shiftHueAway(27.5, 45, 10)).toBe(17.5)
  })
})

describe('clampHue', () => {
  it('holds a hue inside its band', () => {
    expect(clampHue(65, 25, 30)).toBe(30)
    expect(clampHue(10, 25, 30)).toBe(25)
    expect(clampHue(27, 25, 30)).toBe(27)
  })
})

describe('chroma compensation', () => {
  it('takes chroma away from yellow-greens, which read as more saturated', () => {
    expect(chromaCompensationFactor(120)).toBeCloseTo(1 - MAX_CHROMA_COMPENSATION, 6)
    expect(compensateChroma(0.14, 120)).toBeLessThan(0.14)
  })

  it('gives chroma back to blues, which read as less saturated', () => {
    expect(chromaCompensationFactor(260)).toBeCloseTo(1 + MAX_CHROMA_COMPENSATION, 6)
  })

  it('leaves hues outside both bands untouched', () => {
    expect(chromaCompensationFactor(0)).toBe(1)
    expect(compensateChroma(0.14, 0)).toBe(0.14)
  })

  it('never corrects by more than fifteen percent', () => {
    for (let hue = 0; hue < 360; hue += 1) {
      expect(Math.abs(chromaCompensationFactor(hue) - 1)).toBeLessThanOrEqual(
        MAX_CHROMA_COMPENSATION + 1e-9,
      )
    }
  })
})
