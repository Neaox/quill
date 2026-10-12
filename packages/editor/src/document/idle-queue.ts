/**
 * Work the editor can do later, done when the browser is idle (quill-plan.md
 * section 31: after a paste, no main-thread task longer than 50 ms).
 *
 * A paste of a whole document lands in one transaction, and everything that
 * enriches it — a code block's live editor, its colours — would otherwise be
 * built in that same task. Queued here instead, each piece runs in an idle
 * period, as many as fit, so a keystroke between them is answered at once.
 * What is on screen goes first: a task is scheduled as `visible` or
 * `background`, and every visible one runs before any background one. Every
 * task can be cancelled, which is what a block that is deleted, or opened by
 * the writer before its turn came, does with its pending work.
 *
 * One queue per page (`pageIdleQueue`), because idle time is the page's and a
 * hundred blocks each asking for their own callback would contend for it.
 */

export interface IdleDeadlineLike {
  timeRemaining(): number
  readonly didTimeout: boolean
}

/** Where idle periods come from: the browser's, or a test's. */
export interface IdleHost {
  /** Calls back in the next idle period; returns what cancels the request. */
  request(callback: (deadline: IdleDeadlineLike) => void): () => void
}

export type IdlePriority = 'visible' | 'background'

export interface IdleQueue {
  /** Runs `task` in an idle period, visible work first; returns what cancels it. */
  schedule(task: () => void, priority?: IdlePriority): () => void
  /** Tasks waiting to run. */
  readonly size: number
}

/** The longest an idle request waits before it runs anyway, so enrichment always arrives. */
const IDLE_TIMEOUT_MS = 250

/** What a period is assumed to hold where the browser cannot say: half a frame. */
const FALLBACK_BUDGET_MS = 8

/** The slice of a window the browser host reads. */
export interface IdleWindow {
  readonly requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number
  readonly cancelIdleCallback?: (handle: number) => void
  readonly setTimeout: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
  readonly performance: Pick<Performance, 'now'>
}

/**
 * The browser's idle callbacks, or, where there are none (Safari), a timer
 * that offers half a frame: short enough that a keystroke waiting behind it
 * is still answered within the frame.
 */
export function browserIdleHost(view: IdleWindow): IdleHost {
  const { requestIdleCallback, cancelIdleCallback } = view
  if (requestIdleCallback !== undefined && cancelIdleCallback !== undefined) {
    return {
      request: (callback) => {
        const handle = requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS })
        return () => {
          cancelIdleCallback(handle)
        }
      },
    }
  }
  return {
    request: (callback) => {
      const timer = view.setTimeout(() => {
        const end = view.performance.now() + FALLBACK_BUDGET_MS
        callback({ timeRemaining: () => end - view.performance.now(), didTimeout: false })
      }, 1)
      return () => {
        view.clearTimeout(timer)
      }
    },
  }
}

interface Entry {
  readonly task: () => void
}

export function createIdleQueue(host: IdleHost): IdleQueue {
  const queues: Record<IdlePriority, Set<Entry>> = { visible: new Set(), background: new Set() }
  /** Cancels the idle request outstanding, if there is one. */
  let cancelRequest: (() => void) | undefined
  const stopAsking = (): void => {
    const cancel = cancelRequest
    cancelRequest = undefined
    cancel?.()
  }

  const size = () => queues.visible.size + queues.background.size

  const next = (): Entry | undefined => {
    for (const queue of [queues.visible, queues.background]) {
      for (const entry of queue) {
        queue.delete(entry)
        return entry
      }
    }
    return undefined
  }

  const run = (deadline: IdleDeadlineLike): void => {
    cancelRequest = undefined
    try {
      // One task always runs, so a page that is never idle still gets there.
      let first = true
      while (first || deadline.timeRemaining() > 0) {
        first = false
        const entry = next()
        if (entry === undefined) break
        entry.task()
      }
    } finally {
      // A task that throws is reported as any uncaught error is, and costs
      // its own block its enrichment: the rest carry on in the next period.
      if (size() > 0) cancelRequest = host.request(run)
    }
  }

  return {
    schedule(task, priority = 'visible') {
      const entry: Entry = { task }
      queues[priority].add(entry)
      cancelRequest ??= host.request(run)
      return () => {
        queues[priority].delete(entry)
        if (size() === 0) stopAsking()
      }
    },
    get size() {
      return size()
    },
  }
}

let page: IdleQueue | undefined

/** The page's one queue, made the first time something asks for it. */
export function pageIdleQueue(): IdleQueue {
  page ??= createIdleQueue(browserIdleHost(window))
  return page
}
