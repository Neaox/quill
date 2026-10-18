import { OutboundRequestError } from './outbound-error.ts'

/**
 * A bound on how much outbound work is in flight (ADR-042).
 *
 * Previews fetch whatever a person pasted, from hosts that may answer slowly
 * on purpose. Unbounded, a burst of pastes (or one person with a long list)
 * opens as many sockets and buffers as there are links, and a tarpit host
 * costs a connection each for the full budget. So at most `maxConcurrent` run
 * at once, up to `maxQueued` more wait their turn in order, and anything past
 * that is refused at once with `too_busy`, which callers treat as "try again
 * later" and never as a verdict on the link.
 *
 * This bounds the process as a whole. Fairness (one organisation or one host
 * not taking every slot) is the per-host and per-organisation rate limit's
 * job, a layer above.
 */

export interface Limiter {
  run<T>(work: () => Promise<T>): Promise<T>
}

export interface LimiterOptions {
  readonly maxConcurrent: number
  readonly maxQueued: number
}

export function createLimiter({ maxConcurrent, maxQueued }: LimiterOptions): Limiter {
  let running = 0
  const waiting: (() => void)[] = []

  function release(): void {
    const next = waiting.shift()
    // Hand the slot straight to the next in line, so `running` never dips and a
    // newcomer cannot overtake the queue.
    if (next === undefined) running -= 1
    else next()
  }

  async function acquire(): Promise<void> {
    if (running < maxConcurrent) {
      running += 1
      return
    }
    if (waiting.length >= maxQueued) {
      throw new OutboundRequestError('too_busy', 'Too many outbound requests are in flight')
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
  }

  return {
    async run(work) {
      await acquire()
      try {
        return await work()
      } finally {
        release()
      }
    },
  }
}
