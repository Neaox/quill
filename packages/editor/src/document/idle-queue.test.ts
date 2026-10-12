import { describe, expect, it, vi } from 'vitest'

import { browserIdleHost, createIdleQueue, pageIdleQueue } from './idle-queue.ts'
import type { IdleDeadlineLike, IdleHost } from './idle-queue.ts'

/** An idle host the test drives: each `idle(ms)` is one idle period of that length. */
function fakeHost() {
  let pending: ((deadline: IdleDeadlineLike) => void) | undefined
  let now = 0
  const host: IdleHost = {
    request: (callback) => {
      pending = callback
      return () => {
        pending = undefined
      }
    },
  }
  return {
    host,
    get requested() {
      return pending !== undefined
    },
    /** Runs one idle period; each task the queue runs takes `cost` ms of it. */
    idle(budget: number, didTimeout = false) {
      const callback = pending
      pending = undefined
      const end = now + budget
      callback?.({ timeRemaining: () => Math.max(0, end - now), didTimeout })
      now = end
    },
    spend(ms: number) {
      now += ms
    },
  }
}

describe('the idle queue', () => {
  it('runs nothing until the browser is idle', () => {
    const fake = fakeHost()
    const queue = createIdleQueue(fake.host)
    const task = vi.fn()
    queue.schedule(task)
    expect(task).not.toHaveBeenCalled()
    expect(queue.size).toBe(1)
    fake.idle(10)
    expect(task).toHaveBeenCalledOnce()
    expect(queue.size).toBe(0)
    expect(fake.requested).toBe(false)
  })

  it('runs what is visible before what is not, each in the order it was asked for', () => {
    const fake = fakeHost()
    const queue = createIdleQueue(fake.host)
    const order: string[] = []
    queue.schedule(() => order.push('background one'), 'background')
    queue.schedule(() => order.push('visible one'), 'visible')
    queue.schedule(() => order.push('background two'), 'background')
    queue.schedule(() => order.push('visible two'), 'visible')
    fake.idle(50)
    expect(order).toEqual(['visible one', 'visible two', 'background one', 'background two'])
  })

  it('stops when the idle period is spent and carries on in the next', () => {
    const fake = fakeHost()
    const queue = createIdleQueue(fake.host)
    const ran: number[] = []
    for (const index of [1, 2, 3, 4]) {
      queue.schedule(() => {
        ran.push(index)
        fake.spend(4)
      })
    }
    fake.idle(8)
    expect(ran).toEqual([1, 2])
    expect(fake.requested).toBe(true)
    fake.idle(8)
    expect(ran).toEqual([1, 2, 3, 4])
  })

  it('runs one task even in a period with no time left, so work cannot starve', () => {
    const fake = fakeHost()
    const queue = createIdleQueue(fake.host)
    const task = vi.fn()
    queue.schedule(task)
    queue.schedule(task)
    fake.idle(0, true)
    expect(task).toHaveBeenCalledOnce()
  })

  it('forgets a task that is cancelled before it runs, and stops asking when none is left', () => {
    const fake = fakeHost()
    const queue = createIdleQueue(fake.host)
    const task = vi.fn()
    const cancel = queue.schedule(task)
    cancel()
    cancel()
    expect(queue.size).toBe(0)
    expect(fake.requested).toBe(false)
    fake.idle(10)
    expect(task).not.toHaveBeenCalled()
  })

  it('still runs the others when one of them is cancelled', () => {
    const fake = fakeHost()
    const queue = createIdleQueue(fake.host)
    const kept = vi.fn()
    const dropped = vi.fn()
    queue.schedule(kept, 'background')
    queue.schedule(dropped, 'background')()
    fake.idle(10)
    expect(kept).toHaveBeenCalledOnce()
    expect(dropped).not.toHaveBeenCalled()
  })

  it('lets a running task cancel one that has not run yet', () => {
    const fake = fakeHost()
    const queue = createIdleQueue(fake.host)
    const later = vi.fn()
    let cancelLater = (): void => undefined
    queue.schedule(() => {
      cancelLater()
    })
    cancelLater = queue.schedule(later)
    fake.idle(10)
    expect(later).not.toHaveBeenCalled()
    expect(fake.requested).toBe(false)
  })

  it('reports a task that throws and carries on with the rest in the next period', () => {
    const fake = fakeHost()
    const queue = createIdleQueue(fake.host)
    const after = vi.fn()
    queue.schedule(() => {
      throw new Error('broken')
    })
    queue.schedule(after)
    expect(() => {
      fake.idle(10)
    }).toThrow('broken')
    fake.idle(10)
    expect(after).toHaveBeenCalledOnce()
  })
})

describe('the browser idle host', () => {
  it('asks for idle callbacks with a deadline, and cancels them', () => {
    const requestIdleCallback = vi.fn((_callback: IdleRequestCallback) => 7)
    const cancelIdleCallback = vi.fn()
    const host = browserIdleHost({
      requestIdleCallback,
      cancelIdleCallback,
      setTimeout,
      clearTimeout,
      performance,
    })
    const callback = vi.fn()
    const cancel = host.request(callback)
    expect(requestIdleCallback).toHaveBeenCalledWith(callback, { timeout: 250 })
    cancel()
    expect(cancelIdleCallback).toHaveBeenCalledWith(7)
  })

  it('falls back to a short timer with a frame-sized budget where there is no idle callback', () => {
    vi.useFakeTimers()
    const host = browserIdleHost({ setTimeout, clearTimeout, performance })
    const deadlines: IdleDeadlineLike[] = []
    host.request((deadline) => deadlines.push(deadline))
    const cancel = host.request(() => deadlines.push({ timeRemaining: () => -1, didTimeout: true }))
    cancel()
    vi.advanceTimersByTime(1)
    expect(deadlines).toHaveLength(1)
    const [deadline] = deadlines
    expect(deadline?.didTimeout).toBe(false)
    expect(deadline?.timeRemaining()).toBeGreaterThan(0)
    expect(deadline?.timeRemaining()).toBeLessThanOrEqual(8)
    vi.useRealTimers()
  })
})

describe("the page's queue", () => {
  it('is one queue, made once', () => {
    expect(pageIdleQueue()).toBe(pageIdleQueue())
    expect(pageIdleQueue().size).toBe(0)
  })
})
