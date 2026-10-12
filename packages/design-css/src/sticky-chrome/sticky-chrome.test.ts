// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { STICKY_CHROME_TOP, trackStickyChrome } from './sticky-chrome.ts'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
})

function bar(height: number): HTMLElement {
  const header = document.createElement('header')
  document.body.append(header)
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 375, height))
  return header
}

describe('the sticky chrome', () => {
  it('sets the top to the bar’s height, follows it as it wraps, and takes it away again', () => {
    const header = bar(61)
    let resized: (() => void) | undefined
    const disconnect = vi.fn<() => void>()
    class Observer {
      constructor(callback: () => void) {
        resized = callback
      }
      observe = vi.fn<(target: Element) => void>()
      disconnect = disconnect
    }
    const root = document.documentElement

    const stop = trackStickyChrome(header, root, Observer)
    expect(root.style.getPropertyValue(STICKY_CHROME_TOP)).toBe('61px')

    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 375, 118))
    resized?.()
    expect(root.style.getPropertyValue(STICKY_CHROME_TOP)).toBe('118px')

    stop()
    expect(disconnect).toHaveBeenCalled()
    expect(root.style.getPropertyValue(STICKY_CHROME_TOP)).toBe('')
  })

  it('measures once where there is no ResizeObserver, and does nothing without a bar', () => {
    const root = document.documentElement

    const stop = trackStickyChrome(bar(40), root)
    expect(root.style.getPropertyValue(STICKY_CHROME_TOP)).toBe('40px')
    stop()

    expect(trackStickyChrome(null, root)()).toBeUndefined()
    expect(root.style.getPropertyValue(STICKY_CHROME_TOP)).toBe('')
  })
})
