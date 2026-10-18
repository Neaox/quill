import { describe, expect, it } from 'vitest'

import { createLimiter } from './limiter.ts'
import { OutboundRequestError } from './outbound-client.ts'

/** Lets every promise continuation that is already waiting run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** A job the test finishes by hand. */
function job() {
  const { promise, resolve } = Promise.withResolvers<string>()
  return { promise, finish: (value = 'done') => resolve(value), work: () => promise }
}

describe('createLimiter', () => {
  it('runs work straight away while there is room, and returns its result', async () => {
    const limiter = createLimiter({ maxConcurrent: 2, maxQueued: 0 })
    expect(await limiter.run(async () => 'result')).toBe('result')
  })

  it('never runs more than the limit at once, and starts queued work in order', async () => {
    const limiter = createLimiter({ maxConcurrent: 2, maxQueued: 10 })
    const started: number[] = []
    const jobs = Array.from({ length: 5 }, () => job())
    const results = jobs.map((entry, index) =>
      limiter.run(() => {
        started.push(index)
        return entry.work()
      }),
    )
    await flush()
    expect(started).toEqual([0, 1])

    jobs[0]?.finish()
    await results[0]
    await flush()
    expect(started).toEqual([0, 1, 2])

    jobs[1]?.finish()
    jobs[2]?.finish()
    await Promise.all([results[1], results[2]])
    await flush()
    expect(started).toEqual([0, 1, 2, 3, 4])

    jobs[3]?.finish()
    jobs[4]?.finish()
    await Promise.all(results)
  })

  it('refuses at once when the queue is full, as a busy signal rather than a failure of the link', async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxQueued: 1 })
    const running = job()
    const queued = job()
    const first = limiter.run(running.work)
    const second = limiter.run(queued.work)
    await expect(limiter.run(async () => 'third')).rejects.toBeInstanceOf(OutboundRequestError)
    await expect(limiter.run(async () => 'third')).rejects.toMatchObject({ reason: 'too_busy' })
    running.finish()
    queued.finish()
    await Promise.all([first, second])
  })

  it('frees the slot when work throws, so one failure cannot starve the rest', async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxQueued: 1 })
    await expect(
      limiter.run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await limiter.run(async () => 'next')).toBe('next')
  })

  it('does not let a newcomer overtake the queue when a slot frees', async () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxQueued: 5 })
    const order: string[] = []
    const first = job()
    const a = limiter.run(first.work)
    const b = limiter.run(async () => order.push('queued'))
    first.finish()
    await a
    const c = limiter.run(async () => order.push('newcomer'))
    await Promise.all([b, c])
    expect(order).toEqual(['queued', 'newcomer'])
  })
})
