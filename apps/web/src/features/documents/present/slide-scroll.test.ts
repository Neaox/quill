import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { canScroll, enterSlide, scrollSlide, slideScroller } from './slide-scroll.ts'

/** A scroller with a size, since a test has no layout: `content` tall in a window of `window`. */
function scrollerOf(content: number, window: number, at = 0): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperty(element, 'scrollHeight', { value: content, configurable: true })
  Object.defineProperty(element, 'clientHeight', { value: window, configurable: true })
  element.scrollTop = at
  return element
}

/** The live slide of a presenter window, `content` tall in a window 800 tall, scrolled to `at`. */
function liveSlide(content: number, at = 0): HTMLElement {
  document.body.innerHTML =
    '<div data-live="true"><section class="present-step"><div></div></section></div>'
  const slide = document.querySelector('.present-step')
  if (!(slide instanceof HTMLElement)) throw new Error('no slide')
  Object.defineProperty(slide, 'scrollHeight', {
    value: content,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(slide, 'clientHeight', { value: 800, configurable: true })
  slide.scrollTop = at
  return slide
}

afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(document, 'scrollingElement')
})

describe('whether a slide can scroll', () => {
  it('can go forward until it reaches its end, and back until it reaches its start', () => {
    expect(canScroll(scrollerOf(2000, 800, 0), 'forward')).toBe(true)
    expect(canScroll(scrollerOf(2000, 800, 0), 'back')).toBe(false)
    expect(canScroll(scrollerOf(2000, 800, 600), 'forward')).toBe(true)
    expect(canScroll(scrollerOf(2000, 800, 600), 'back')).toBe(true)
    expect(canScroll(scrollerOf(2000, 800, 1200), 'forward')).toBe(false)
  })

  it('treats a fraction of a pixel short of the end as the end', () => {
    expect(canScroll(scrollerOf(2000, 800, 1199.5), 'forward')).toBe(false)
  })

  it('counts a scaled slide that stops a pixel or two short of its end as being at it', () => {
    // The presenter's live slide, which is scaled: it reads 196 to go and stops at 194.84.
    expect(canScroll(scrollerOf(1094, 898, 194.84), 'forward')).toBe(false)
    expect(canScroll(scrollerOf(1094, 898, 0.4), 'back')).toBe(false)
  })

  it('cannot scroll a slide that fits its window', () => {
    const fits = scrollerOf(800, 800)
    expect(canScroll(fits, 'forward')).toBe(false)
    expect(canScroll(fits, 'back')).toBe(false)
  })
})

describe('scrolling a slide', () => {
  it('moves a line for an arrow and most of a window for a page', () => {
    const slide = scrollerOf(5000, 1000)

    expect(scrollSlide(slide, 'forward', 'line')).toBe(true)
    expect(slide.scrollTop).toBe(48)
    expect(scrollSlide(slide, 'forward', 'page')).toBe(true)
    expect(slide.scrollTop).toBe(48 + 900)
    expect(scrollSlide(slide, 'back', 'page')).toBe(true)
    expect(slide.scrollTop).toBe(48)
  })

  it('says it did not when there was nowhere to go, which is when the key steps instead', () => {
    expect(scrollSlide(scrollerOf(800, 800), 'forward', 'page')).toBe(false)
    expect(scrollSlide(scrollerOf(2000, 800, 0), 'back', 'line')).toBe(false)
    expect(scrollSlide(null, 'forward', 'line')).toBe(false)
  })
})

describe('where the scrolling is', () => {
  it('is the live slide in a presenter window, which scrolls inside itself', () => {
    document.body.innerHTML =
      '<div data-live="true"><section class="present-step"></section></div>' +
      '<div><section class="present-step"></section></div>'

    expect(slideScroller()).toBe(document.querySelector('[data-live] > .present-step'))
  })

  it('is the page everywhere else', () => {
    document.body.innerHTML = '<section class="present-step"></section>'
    // A test has no layout, so the page's scrolling element is stood in for.
    Object.defineProperty(document, 'scrollingElement', {
      value: document.documentElement,
      configurable: true,
    })

    expect(slideScroller()).toBe(document.documentElement)
  })

  it('is nothing at all in a document with no layout', () => {
    Object.defineProperty(document, 'scrollingElement', { value: undefined, configurable: true })

    expect(slideScroller()).toBeNull()
  })
})

describe('entering a slide', () => {
  it('starts at the top when arriving from before', () => {
    const slide = liveSlide(3000, 1500)

    enterSlide('top')

    expect(slide.scrollTop).toBe(0)
  })

  it('starts at the bottom when arriving from after', () => {
    const slide = liveSlide(3000)

    enterSlide('bottom')

    expect(slide.scrollTop).toBe(2200)
  })
})

describe('a slide entered from below while it is still taking its size', () => {
  let resized: () => void
  let disconnected: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    disconnected = false
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe(): void {}
        disconnect(): void {
          disconnected = true
        }
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is kept at its foot as it grows, so the person is not left partway up it', () => {
    const slide = liveSlide(1000)
    enterSlide('bottom')
    expect(slide.scrollTop).toBe(200)

    Object.defineProperty(slide, 'scrollHeight', { value: 1600, configurable: true })
    resized()

    expect(slide.scrollTop).toBe(800)
  })

  it('is left alone once the person has moved it', () => {
    const slide = liveSlide(1000)
    enterSlide('bottom')
    slide.scrollTop = 50

    Object.defineProperty(slide, 'scrollHeight', { value: 1600, configurable: true })
    resized()

    expect(slide.scrollTop).toBe(50)
  })

  it('stops watching when it has settled, and when told to', () => {
    liveSlide(1000)
    enterSlide('bottom')
    vi.advanceTimersByTime(1500)
    expect(disconnected).toBe(true)

    disconnected = false
    const stop = enterSlide('bottom')
    stop()
    expect(disconnected).toBe(true)
  })

  it('does not watch a slide entered from above, which is already where it should be', () => {
    liveSlide(1000)
    const stop = enterSlide('top')
    stop()

    expect(disconnected).toBe(false)
  })

  it('has nothing to place when there is no slide to scroll', () => {
    document.body.innerHTML = ''
    Object.defineProperty(document, 'scrollingElement', { value: undefined, configurable: true })

    expect(() => {
      enterSlide('bottom')()
    }).not.toThrow()
  })
})
