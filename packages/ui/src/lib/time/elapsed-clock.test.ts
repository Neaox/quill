import { describe, expect, it, vi } from 'vitest'

import { createElapsedClock, type ElapsedClockHost } from './elapsed-clock.ts'

const START = Date.UTC(2026, 0, 1, 12, 0, 0)

/** A signed 32-bit count of milliseconds: a timer set for more wraps round and fires at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1

/** A host whose time and timers are the test's: time moves only when it is told to. */
function aHost() {
  let now = START
  const timers = new Map<number, { at: number; run: () => void }>()
  let next = 0
  const host: ElapsedClockHost = {
    now: () => now,
    schedule: (run, delayMs) => {
      const id = next++
      timers.set(id, { at: now + delayMs, run })
      return () => {
        timers.delete(id)
      }
    },
  }
  return {
    host,
    pending: () => timers.size,
    /** Time passes and no timer runs: a page that was out of sight. */
    jump(ms: number) {
      now += ms
    },
    /** Moves time on and runs every timer that falls due, in order, as a real clock would. */
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .toSorted(([, a], [, b]) => a.at - b.at)[0]
        if (due === undefined) break
        now = Math.max(now, due[1].at)
        timers.delete(due[0])
        due[1].run()
      }
      now = target
    },
  }
}

const ago = (seconds: number) => START - seconds * 1000

describe('the elapsed clock', () => {
  it('says what a time reads now, and wakes the listener when it reads differently', () => {
    const { host, advance } = aHost()
    const clock = createElapsedClock(host)
    const listener = vi.fn<() => void>()
    clock.subscribe(ago(10), 'en', listener)
    expect(clock.read(ago(10), 'en')).toBe('just now')

    advance(34_000)
    expect(listener).not.toHaveBeenCalled()
    advance(2000)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(clock.read(ago(10), 'en')).toBe('1 minute ago')
  })

  it('keeps one timer for any number of times, set for the earliest change', () => {
    const { host, pending } = aHost()
    const clock = createElapsedClock(host)

    for (let n = 0; n < 1000; n += 1) clock.subscribe(ago(600 + n), 'en', vi.fn<() => void>())

    expect(clock.listeners()).toBe(1000)
    expect(pending()).toBe(1)
  })

  it('wakes only the times that read differently, not all of them', () => {
    const { host, advance } = aHost()
    const clock = createElapsedClock(host)
    const soon = vi.fn<() => void>()
    const later = vi.fn<() => void>()
    clock.subscribe(ago(100), 'en', soon) // changes at 150 seconds
    clock.subscribe(ago(7200), 'en', later) // "2 hours ago" until 2.5 hours

    advance(60_000)

    expect(soon).toHaveBeenCalledTimes(1)
    expect(later).not.toHaveBeenCalled()
  })

  it('moves its timer sooner for a time that reads differently sooner than the one it is set for', () => {
    const { host, advance, pending } = aHost()
    const clock = createElapsedClock(host)
    const far = vi.fn<() => void>()
    const near = vi.fn<() => void>()
    clock.subscribe(ago(7200), 'en', far)

    clock.subscribe(ago(10), 'en', near)
    advance(36_000)

    expect(pending()).toBe(1)
    expect(near).toHaveBeenCalledTimes(1)
    expect(far).not.toHaveBeenCalled()
  })

  it('has no timer at all when nothing is listening, and none left when the last one goes', () => {
    const { host, pending } = aHost()
    const clock = createElapsedClock(host)
    expect(pending()).toBe(0)

    const stop = clock.subscribe(ago(10), 'en', vi.fn<() => void>())
    const stopAnother = clock.subscribe(ago(20), 'en', vi.fn<() => void>())
    expect(pending()).toBe(1)
    stop()
    expect(pending()).toBe(1)
    stopAnother()

    expect(pending()).toBe(0)
    expect(clock.listeners()).toBe(0)
  })

  it('says a time as of now when it was idle, not as of when it last ran', () => {
    const { host, advance } = aHost()
    const clock = createElapsedClock(host)
    clock.subscribe(ago(10), 'en', vi.fn<() => void>())()
    advance(3_600_000)

    expect(clock.read(ago(10), 'en')).toBe('1 hour ago')
    const listener = vi.fn<() => void>()
    clock.subscribe(ago(10), 'en', listener)
    advance(1)
    expect(listener).not.toHaveBeenCalled()
  })

  it('catches up all at once when it is told the page is back in front', () => {
    const { host, jump } = aHost()
    const clock = createElapsedClock(host)
    const listener = vi.fn<() => void>()
    clock.subscribe(ago(10), 'en', listener)
    jump(3_600_000)
    expect(listener).not.toHaveBeenCalled()

    clock.refresh()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(clock.read(ago(10), 'en')).toBe('1 hour ago')
  })

  it('does not spin for a time that is on a boundary', () => {
    const { host, advance, pending } = aHost()
    const clock = createElapsedClock(host)
    clock.subscribe(ago(44.9), 'en', vi.fn<() => void>())

    advance(50)
    advance(50)

    expect(pending()).toBeLessThanOrEqual(1)
  })

  it('never sets a timer longer than a timer can be, for a time whose saying is weeks from changing', () => {
    const delays: number[] = []
    const { host } = aHost()
    const clock = createElapsedClock({
      now: host.now,
      schedule: (run, delayMs) => {
        delays.push(delayMs)
        return host.schedule(run, delayMs)
      },
    })

    // "2 years ago" next reads differently half a year from now.
    clock.subscribe(ago(2 * 365 * 86_400), 'en', vi.fn<() => void>())

    expect(delays.length).toBeGreaterThan(0)
    expect(Math.max(...delays)).toBeLessThanOrEqual(LONGEST_TIMER_MS)
  })

  it('sets no timer for a time that is not one, which never reads differently', () => {
    const { host, pending } = aHost()
    const clock = createElapsedClock(host)

    clock.subscribe(Number.NaN, 'en', vi.fn<() => void>())

    expect(pending()).toBe(0)
    expect(clock.read(Number.NaN, 'en')).toBe('')
  })

  it('lets a listener stop listening when it is woken, without the others missing theirs', () => {
    const { host, advance, pending } = aHost()
    const clock = createElapsedClock(host)
    const woken: string[] = []
    const stop = clock.subscribe(ago(10), 'en', () => {
      woken.push('first')
      stop()
    })
    clock.subscribe(ago(10), 'en', () => woken.push('second'))

    advance(36_000)

    expect(woken).toEqual(['first', 'second'])
    expect(clock.listeners()).toBe(1)
    expect(pending()).toBe(1)
  })

  it('sets no timer when the last listener stops while the timer is running', () => {
    const { host, advance, pending } = aHost()
    const clock = createElapsedClock(host)
    const stop = clock.subscribe(ago(10), 'en', () => {
      stop()
    })

    advance(36_000)

    expect(clock.listeners()).toBe(0)
    expect(pending()).toBe(0)
  })

  it('stays quiet, and keeps watching, when a time comes due and still reads the same', () => {
    const { host, advance, pending } = aHost()
    const clock = createElapsedClock(host)
    const listener = vi.fn<() => void>()
    // A little over an hour ahead: it is due again 148 seconds on, and is still "in 1 hour".
    const ahead = START + 3748 * 1000
    clock.subscribe(ahead, 'en', listener)
    const said = clock.read(ahead, 'en')

    advance(148_100)

    expect(listener).not.toHaveBeenCalled()
    expect(clock.read(ahead, 'en')).toBe(said)
    expect(pending()).toBe(1)
  })

  it('sets no timer when all that is left is a time that never reads differently', () => {
    const { host, advance, pending } = aHost()
    const clock = createElapsedClock(host)
    clock.subscribe(Number.NaN, 'en', vi.fn<() => void>())
    const stop = clock.subscribe(ago(10), 'en', () => {
      stop()
    })

    advance(36_000)

    expect(clock.listeners()).toBe(1)
    expect(pending()).toBe(0)
  })
})
