import { describe, expect, it, vi } from 'vitest'

import {
  alwaysNear,
  createLayoutFrame,
  pageNearness,
  setPageNearness,
  viewportNearness,
} from './measuring.ts'
import type { FrameHost, LayoutRead } from './measuring.ts'

/** A frame host the test advances by hand. */
function manualFrames() {
  let pending: (() => void) | undefined
  let requested = 0
  const host: FrameHost = {
    request(callback) {
      requested += 1
      pending = callback
      return () => {
        pending = undefined
      }
    },
  }
  return {
    host,
    get requested() {
      return requested
    },
    run() {
      const callback = pending
      pending = undefined
      callback?.()
    },
  }
}

describe('a layout frame', () => {
  it('reads everything before it writes anything', () => {
    const frames = manualFrames()
    const frame = createLayoutFrame(frames.host)
    const order: string[] = []
    for (const name of ['table', 'toolbar']) {
      frame.schedule({ name }, () => {
        order.push(`read ${name}`)
        return () => {
          order.push(`write ${name}`)
        }
      })
    }
    frames.run()
    expect(order).toEqual(['read table', 'read toolbar', 'write table', 'write toolbar'])
  })

  it('asks for one frame however much is scheduled, and measures each owner once', () => {
    const frames = manualFrames()
    const frame = createLayoutFrame(frames.host)
    const owner = {}
    const read = vi.fn<LayoutRead>(() => undefined)
    frame.schedule(owner, read)
    frame.schedule(owner, read)
    frame.schedule({}, () => undefined)
    expect(frames.requested).toBe(1)
    frames.run()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('forgets what is cancelled, and asks again for work scheduled after a frame', () => {
    const frames = manualFrames()
    const frame = createLayoutFrame(frames.host)
    const owner = {}
    const read = vi.fn<LayoutRead>(() => undefined)
    frame.schedule(owner, read)
    frame.cancel(owner)
    frames.run()
    expect(read).not.toHaveBeenCalled()
    frame.schedule(owner, read)
    frames.run()
    expect(read).toHaveBeenCalledTimes(1)
    expect(frames.requested).toBe(2)
  })

  it('takes work scheduled by a write into the next frame, not this one', () => {
    const frames = manualFrames()
    const frame = createLayoutFrame(frames.host)
    const later = vi.fn<LayoutRead>(() => undefined)
    frame.schedule({}, () => () => {
      frame.schedule({}, later)
    })
    frames.run()
    expect(later).not.toHaveBeenCalled()
    frames.run()
    expect(later).toHaveBeenCalledTimes(1)
  })
})

const entry = (target: Element, isIntersecting: boolean) =>
  ({ target, isIntersecting }) as IntersectionObserverEntry

describe('nearness to the viewport', () => {
  it('is always near where nothing can say what is on screen', () => {
    const seen: boolean[] = []
    alwaysNear.watch(document.createElement('div'), (near) => seen.push(near))
    expect(seen).toEqual([true])
  })

  it('follows one shared observer, and stops when told', () => {
    const observers: IntersectionObserverCallback[] = []
    const observe = vi.fn<(target: Element) => void>()
    const unobserve = vi.fn<(target: Element) => void>()
    const created = vi.fn<() => void>()
    class FakeObserver {
      constructor(callback: IntersectionObserverCallback) {
        created()
        observers.push(callback)
      }
      observe = observe
      unobserve = unobserve
    }
    const nearness = viewportNearness(FakeObserver as unknown as typeof IntersectionObserver)
    const first = document.createElement('div')
    const second = document.createElement('div')
    const seen: [string, boolean][] = []
    const stop = nearness.watch(first, (near) => seen.push(['first', near]))
    nearness.watch(second, (near) => seen.push(['second', near]))
    expect(created).toHaveBeenCalledTimes(1)
    const notify = (entries: readonly [Element, boolean][]): void => {
      for (const observer of observers) {
        observer(
          entries.map(([target, isIntersecting]) => entry(target, isIntersecting)),
          {} as IntersectionObserver,
        )
      }
    }
    notify([
      [first, true],
      [second, false],
    ])
    stop()
    notify([[first, false]])
    expect(seen).toEqual([
      ['first', true],
      ['second', false],
    ])
    expect(unobserve).toHaveBeenCalledWith(first)
  })
})

describe('the page’s nearness', () => {
  it('watches the viewport where the browser can say what is on screen, and not where it cannot', () => {
    const restore = setPageNearness(undefined)
    try {
      expect(pageNearness()).not.toBe(alwaysNear)
      setPageNearness(undefined)
      vi.stubGlobal('IntersectionObserver', undefined)
      expect(pageNearness()).toBe(alwaysNear)
    } finally {
      vi.unstubAllGlobals()
      restore()
    }
  })
})
