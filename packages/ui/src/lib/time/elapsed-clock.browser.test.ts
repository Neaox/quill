import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const START = new Date('2026-01-01T12:00:00Z')
const ago = (seconds: number) => START.getTime() - seconds * 1000

/** A fresh module, so that each test meets the browser's clock before anything has used it. */
async function anElapsedClock() {
  vi.resetModules()
  return (await import('./elapsed-clock.ts')).elapsedClock
}

function theTabIs(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('the browser’s elapsed clock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is idle until something listens, with no timer and nothing to refresh', async () => {
    const elapsedClock = await anElapsedClock()

    expect(elapsedClock.listeners()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(elapsedClock.read(ago(10), 'en')).toBe('just now')
  })

  it('wakes a listener on the wall clock when its saying changes, and sets nothing once it is gone', async () => {
    const elapsedClock = await anElapsedClock()
    const listener = vi.fn<() => void>()
    const stop = elapsedClock.subscribe(ago(10), 'en', listener)
    expect(elapsedClock.listeners()).toBe(1)

    vi.advanceTimersByTime(36_000)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(elapsedClock.read(ago(10), 'en')).toBe('1 minute ago')

    stop()
    expect(elapsedClock.listeners()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('catches up as the tab comes back to the front, and not as it goes away', async () => {
    const elapsedClock = await anElapsedClock()
    const listener = vi.fn<() => void>()
    elapsedClock.subscribe(ago(10), 'en', listener)

    // The tab was out of sight for an hour and its timer with it.
    vi.setSystemTime(START.getTime() + 3_600_000)
    theTabIs('hidden')
    expect(listener).not.toHaveBeenCalled()

    theTabIs('visible')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(elapsedClock.read(ago(10), 'en')).toBe('1 hour ago')
  })

  it('can be brought up to date by hand, before and after it has been used', async () => {
    const elapsedClock = await anElapsedClock()
    elapsedClock.refresh()
    const listener = vi.fn<() => void>()
    elapsedClock.subscribe(ago(10), 'en', listener)

    vi.setSystemTime(START.getTime() + 3_600_000)
    elapsedClock.refresh()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('works without a document to watch, as when it is read on the server', async () => {
    vi.stubGlobal('document', undefined)
    const elapsedClock = await anElapsedClock()

    expect(elapsedClock.read(ago(10), 'en')).toBe('just now')
    expect(elapsedClock.subscribe(ago(10), 'en', vi.fn<() => void>())).toBeTypeOf('function')
  })
})
