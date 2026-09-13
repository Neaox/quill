/**
 * Time and timers as an injected dependency (ADR-021: "lock and draft modules take
 * the current time as an argument rather than calling now()"). The hooks here never
 * touch `Date.now` or `globalThis.setTimeout` directly, so heartbeat and debounce
 * behaviour is exercised deterministically instead of by waiting in real time.
 */
export interface Clock {
  now(): number
  setTimeout(handler: () => void, delayMs: number): number
  clearTimeout(handle: number): void
}

/** The real clock, used whenever a caller does not inject one. */
export const systemClock: Clock = {
  now: () => Date.now(),
  // Node's timers return an opaque handle rather than a number; it coerces to the
  // same id the browser hands back, which is all `clearTimeout` needs.
  setTimeout: (handler, delayMs) => Number(globalThis.setTimeout(handler, delayMs)),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle)
  },
}

/** A clock whose time only moves when a test moves it. */
export interface FakeClock extends Clock {
  /** Moves time forward, running every callback that falls due, earliest first. */
  advance(ms: number): void
  /** How many timers are still scheduled; a cleanup leak shows up here. */
  readonly pending: number
}

interface ScheduledTask {
  readonly handle: number
  readonly dueAt: number
  readonly handler: () => void
}

/**
 * A manual clock. It ships in production code rather than a test file because
 * `createEditorTestHarness` re-exports it for the web app's own tests.
 */
export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs
  let nextHandle = 1
  let tasks: ScheduledTask[] = []

  const earliestDueBy = (limit: number): ScheduledTask | undefined =>
    tasks.reduce<ScheduledTask | undefined>(
      (earliest, task) =>
        task.dueAt <= limit && (earliest === undefined || task.dueAt < earliest.dueAt)
          ? task
          : earliest,
      undefined,
    )

  return {
    now: () => current,

    setTimeout(handler, delayMs) {
      const handle = nextHandle
      nextHandle += 1
      tasks = [...tasks, { handle, dueAt: current + delayMs, handler }]
      return handle
    },

    clearTimeout(handle) {
      tasks = tasks.filter((task) => task.handle !== handle)
    },

    advance(ms) {
      const target = current + ms
      // A callback may schedule further work that also falls due inside this same
      // advance (the heartbeat loop does exactly that), so re-scan after each run.
      for (let next = earliestDueBy(target); next !== undefined; next = earliestDueBy(target)) {
        tasks = tasks.filter((task) => task.handle !== next.handle)
        current = next.dueAt
        next.handler()
      }
      current = target
    },

    get pending() {
      return tasks.length
    },
  }
}
