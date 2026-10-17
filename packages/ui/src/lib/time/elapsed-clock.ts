import { now } from './clock.ts'
import { elapsedLabel, nextChangeAt } from './elapsed.ts'

/**
 * One clock for every relative time on a page.
 *
 * A page can hold a thousand "2 minutes ago". Each with a timer of its own, or a shared one
 * that re-renders all of them every second, would be a thousand wakeups and a thousand renders
 * to change one word. This keeps one timer, set for the earliest moment *any* of them will
 * read differently (`nextChangeAt`), and when it fires it wakes only the ones that do. A page
 * of times that were all written a minute ago wakes once a minute; one that is a day old wakes
 * hourly; one with nothing on it sets no timer at all.
 *
 * Observer pattern (`docs/architecture/patterns.md`): `subscribe` returns the unsubscribe. It
 * is shaped for `useSyncExternalStore`: a subscribe, and a snapshot that is a plain string,
 * equal while the saying is.
 */

export interface ElapsedClockHost {
  /** The wall clock, in milliseconds. */
  readonly now: () => number
  /** Runs `run` after `delayMs`; returns what cancels it. */
  readonly schedule: (run: () => void, delayMs: number) => () => void
}

interface Entry {
  readonly atMs: number
  readonly locale: string | undefined
  readonly listener: () => void
  label: string
  /** The moment this one next reads differently. */
  changeAt: number
}

export interface ElapsedClock {
  /** Calls `listener` whenever the saying for `atMs` changes; returns the way to stop. */
  readonly subscribe: (atMs: number, locale: string | undefined, listener: () => void) => () => void
  /** What the saying for `atMs` is now. */
  readonly read: (atMs: number, locale: string | undefined) => string
  /** Brings every saying up to date now: for a page that was out of sight and its timer with it. */
  readonly refresh: () => void
  /** How many are listening: a page with none has no timer. */
  readonly listeners: () => number
}

/** A timer is never set for less than this: a handful of times on a boundary must not spin it. */
const MIN_DELAY_MS = 250

/**
 * The longest the one timer waits. A saying that is days or years old changes only a few times a
 * day, so waiting out the whole gap buys nothing, and a delay past a signed 32-bit count of
 * milliseconds (about 24.8 days: "2 years ago" is months from changing) wraps round and fires at
 * once, which would spin the clock. When it fires with nothing due it simply sets the next, and
 * a saying is at worst this much late.
 */
const MAX_DELAY_MS = 60 * 60 * 1000

export function createElapsedClock(host: ElapsedClockHost): ElapsedClock {
  const entries = new Set<Entry>()
  let clockNow = host.now()
  let cancel: (() => void) | undefined
  /** The moment the timer that is set is for. */
  let armedFor = Number.POSITIVE_INFINITY

  /** Brings every saying up to date, waking those that changed. */
  function tick() {
    cancel = undefined
    armedFor = Number.POSITIVE_INFINITY
    clockNow = host.now()
    // Collected first, so that a listener that unsubscribes does not change what is walked.
    const due = [...entries].filter((entry) => entry.changeAt <= clockNow)
    for (const entry of due) {
      entry.changeAt = nextChangeAt(entry.atMs, clockNow)
      const label = elapsedLabel(entry.atMs, clockNow, entry.locale)
      if (label !== entry.label) {
        entry.label = label
        entry.listener()
      }
    }
    arm()
  }

  /** Sets the one timer for the earliest change, unless it is set or there is nothing to wait for. */
  function arm() {
    if (cancel !== undefined || entries.size === 0) return
    const earliest = Math.min(...[...entries].map(({ changeAt }) => changeAt))
    if (earliest === Number.POSITIVE_INFINITY) return
    armedFor = earliest
    cancel = host.schedule(
      tick,
      Math.min(Math.max(earliest - host.now(), MIN_DELAY_MS), MAX_DELAY_MS),
    )
  }

  return {
    subscribe(atMs, locale, listener) {
      // The clock is only kept while something listens; one that has been idle is brought up to
      // date first, so a new time is not said as of when the last one went away.
      if (entries.size === 0) clockNow = host.now()
      const entry: Entry = {
        atMs,
        locale,
        listener,
        label: elapsedLabel(atMs, clockNow, locale),
        changeAt: nextChangeAt(atMs, clockNow),
      }
      entries.add(entry)
      // The timer is moved only for one that reads differently sooner than what it is set for:
      // a thousand times mounted together do not each look at the thousand.
      if (entry.changeAt < armedFor) {
        cancel?.()
        cancel = undefined
        arm()
      }
      return () => {
        entries.delete(entry)
        if (entries.size === 0) {
          cancel?.()
          cancel = undefined
          armedFor = Number.POSITIVE_INFINITY
        }
      }
    },
    read(atMs, locale) {
      if (entries.size === 0) clockNow = host.now()
      return elapsedLabel(atMs, clockNow, locale)
    },
    refresh() {
      cancel?.()
      tick()
    },
    listeners: () => entries.size,
  }
}

/** The browser's: its clock and its timers, and a page that comes back to the front catches up. */
function createBrowserClock(): ElapsedClock {
  let clock: ElapsedClock | undefined
  const host: ElapsedClockHost = {
    now,
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs)
      return () => {
        clearTimeout(timer)
      }
    },
  }
  const held = (): ElapsedClock => {
    if (clock === undefined) {
      clock = createElapsedClock(host)
      // A timer in a tab that is out of sight is slowed or stopped, and the page is stale when
      // it returns: it catches up as it comes back to the front.
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') clock?.refresh()
        })
      }
    }
    return clock
  }
  return {
    subscribe: (...args) => held().subscribe(...args),
    read: (...args) => held().read(...args),
    refresh: () => {
      held().refresh()
    },
    listeners: () => clock?.listeners() ?? 0,
  }
}

export const elapsedClock: ElapsedClock = createBrowserClock()
