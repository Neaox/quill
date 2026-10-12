// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  clampScale,
  FIT,
  gestureHint,
  isWide,
  MAX_SCALE,
  MIN_SCALE,
  pan,
  zoomAt,
} from './lightbox.ts'

describe('zooming a diagram', () => {
  it('stays between fitting the stage and eight times its size', () => {
    expect(MIN_SCALE).toBe(1)
    expect(MAX_SCALE).toBe(8)
    expect(clampScale(0.2)).toBe(1)
    expect(clampScale(3)).toBe(3)
    expect(clampScale(40)).toBe(8)
  })

  it('starts fitted, at the origin', () => {
    expect(FIT).toEqual({ scale: 1, x: 0, y: 0 })
  })

  it('keeps the point under the pointer where it was', () => {
    // Doubling about (100, 50): that point in the drawing must stay at (100, 50)
    // on screen, so the drawing moves up and left by as much as it grew there.
    const zoomed = zoomAt(FIT, 2, { x: 100, y: 50 })
    expect(zoomed).toEqual({ scale: 2, x: -100, y: -50 })

    const back = zoomAt(zoomed, 1, { x: 100, y: 50 })
    expect(back).toEqual(FIT)
  })

  it('goes no further than its bounds, and leaves the view alone when it cannot move', () => {
    const atMost = zoomAt({ scale: 8, x: -10, y: -10 }, 12, { x: 0, y: 0 })
    expect(atMost).toEqual({ scale: 8, x: -10, y: -10 })
  })

  it('pans by the distance dragged, and not at all when fitted', () => {
    expect(pan({ scale: 2, x: -100, y: -50 }, { x: 30, y: -10 })).toEqual({
      scale: 2,
      x: -70,
      y: -60,
    })
    expect(pan(FIT, { x: 30, y: 10 })).toEqual(FIT)
  })
})

function svg(attributes: string): SVGSVGElement {
  const holder = document.createElement('div')
  holder.innerHTML = `<svg ${attributes}></svg>`
  const element = holder.querySelector('svg')
  if (element === null) throw new Error('no svg')
  return element
}

describe('the gesture hint', () => {
  const device = { touch: true, portrait: false, wide: true }

  it('speaks of the wheel to a mouse and of fingers to a touch screen', () => {
    expect(gestureHint({ ...device, touch: false, portrait: true })).toEqual({
      text: 'Scroll to zoom · drag to pan',
      turn: false,
    })
    expect(gestureHint(device)).toEqual({ text: 'Pinch to zoom · drag to pan', turn: false })
  })

  it('suggests turning a touch screen held upright only for a wide drawing, which it would enlarge', () => {
    expect(gestureHint({ ...device, portrait: true })).toEqual({
      text: 'Turn your phone for a larger view',
      turn: true,
    })
    expect(gestureHint({ ...device, portrait: true, wide: false })).toEqual({
      text: 'Pinch to zoom · drag to pan',
      turn: false,
    })
  })
})

describe('a wide drawing', () => {
  it('is one clearly wider than it is tall, by its view box', () => {
    expect(isWide(svg('viewBox="0 0 1200 600"'))).toBe(true)
    expect(isWide(svg('viewBox="0 0 600 600"'))).toBe(false)
    expect(isWide(svg('viewBox="0 0 400 900"'))).toBe(false)
  })

  it('falls back to its width and height, and is not wide when it says neither', () => {
    expect(isWide(svg('width="800" height="300"'))).toBe(true)
    expect(isWide(svg(''))).toBe(false)
  })
})
