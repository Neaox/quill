import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeClock } from '../test-support/fakes.ts'
import { createJobRunner, type LanePoll, type OutboxPoll } from './job-runner.ts'
import type { LaneResult } from '../infrastructure/outbox/lane.ts'
import type { OutboxConsumer } from '../infrastructure/outbox/consumer.ts'
import type { PollResult } from '../infrastructure/outbox/poller.ts'

const RESULT: PollResult = { processed: 1, failed: 0, deadLettered: 0 }

/** A promise plus the function that settles it, for holding a poll open. */
function pause(): { readonly waited: Promise<void>; readonly release: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>()
  return { waited: promise, release: () => resolve() }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduled jobs', () => {
  it('runs a job once its interval has elapsed, and not before', async () => {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const runner = createJobRunner({
      poll: vi.fn<OutboxPoll>().mockResolvedValue(RESULT),
      clock,
    })
    const run = vi.fn<(now: Date) => Promise<void>>().mockResolvedValue(undefined)
    runner.schedule({ name: 'sweep', intervalMs: 60_000, run })

    // Scheduled means "one interval from now", not "immediately".
    expect(await runner.runDueJobs()).toEqual([])
    clock.advance(60_000)
    expect(await runner.runDueJobs()).toEqual(['sweep'])
    expect(run).toHaveBeenCalledTimes(1)
    // And not again until the next interval.
    expect(await runner.runDueJobs()).toEqual([])
  })

  it('reports a job that throws without stopping the ones after it', async () => {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const onPollError = vi.fn<(error: unknown) => void>()
    const runner = createJobRunner({
      poll: vi.fn<OutboxPoll>().mockResolvedValue(RESULT),
      clock,
      onPollError,
    })
    runner.schedule({
      name: 'broken',
      intervalMs: 1,
      run: vi.fn<(now: Date) => Promise<void>>().mockRejectedValue(new Error('boom')),
    })
    runner.schedule({
      name: 'fine',
      intervalMs: 1,
      run: vi.fn<(now: Date) => Promise<void>>().mockResolvedValue(undefined),
    })

    clock.advance(10)
    // Housekeeping failing must not take the outbox down with it.
    expect(await runner.runDueJobs()).toEqual(['fine'])
    expect(onPollError).toHaveBeenCalledTimes(1)
  })

  it('runs due jobs on the same tick as a poll', async () => {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const poll = vi.fn<OutboxPoll>().mockResolvedValue(RESULT)
    const runner = createJobRunner({ poll, clock, intervalMs: 10 })
    const run = vi.fn<(now: Date) => Promise<void>>().mockResolvedValue(undefined)
    runner.schedule({ name: 'sweep', intervalMs: 5, run })

    runner.start()
    clock.advance(10)
    await vi.advanceTimersByTimeAsync(10)
    await runner.stop()

    expect(poll).toHaveBeenCalled()
    expect(run).toHaveBeenCalled()
  })
})

describe('createJobRunner', () => {
  it('registers a consumer and passes the registry to poll', async () => {
    const poll = vi.fn<OutboxPoll>().mockResolvedValue(RESULT)
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const runner = createJobRunner({ poll, clock })
    const consumer: OutboxConsumer = {
      eventType: 'DocumentCreated',
      handle: vi.fn<() => Promise<void>>(),
    }
    runner.register(consumer)

    await runner.pollOnce()

    expect(poll).toHaveBeenCalledWith(new Map([['DocumentCreated', consumer]]), clock.now())
  })

  it('polls once immediately without waiting for the schedule', async () => {
    const poll = vi.fn<OutboxPoll>().mockResolvedValue(RESULT)
    const runner = createJobRunner({ poll, clock: createFakeClock(new Date()) })
    expect(await runner.pollOnce()).toEqual(RESULT)
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('polls on an interval once started, and stops on stop()', async () => {
    const poll = vi.fn<OutboxPoll>().mockResolvedValue(RESULT)
    const runner = createJobRunner({ poll, clock: createFakeClock(new Date()), intervalMs: 1000 })

    runner.start()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(poll).toHaveBeenCalledTimes(2)

    await runner.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('starting twice does not schedule a second interval', async () => {
    const poll = vi.fn<OutboxPoll>().mockResolvedValue(RESULT)
    const runner = createJobRunner({ poll, clock: createFakeClock(new Date()), intervalMs: 1000 })

    runner.start()
    runner.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(poll).toHaveBeenCalledTimes(1)

    await runner.stop()
  })

  it('defaults the interval to 1000ms when none is given', async () => {
    const poll = vi.fn<OutboxPoll>().mockResolvedValue(RESULT)
    const runner = createJobRunner({ poll, clock: createFakeClock(new Date()) })

    runner.start()
    await vi.advanceTimersByTimeAsync(999)
    expect(poll).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(poll).toHaveBeenCalledTimes(1)

    await runner.stop()
  })

  it('stopping when never started is a harmless no-op', async () => {
    const runner = createJobRunner({
      poll: vi.fn<OutboxPoll>().mockResolvedValue(RESULT),
      clock: createFakeClock(new Date()),
    })
    await expect(runner.stop()).resolves.toBeUndefined()
  })

  it('reports a poll failure through onPollError instead of throwing into the loop', async () => {
    const failure = new Error('db unreachable')
    const poll = vi.fn<OutboxPoll>().mockRejectedValue(failure)
    const onPollError = vi.fn<(error: unknown) => void>()
    const runner = createJobRunner({
      poll,
      clock: createFakeClock(new Date()),
      intervalMs: 1000,
      onPollError,
    })

    runner.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onPollError).toHaveBeenCalledWith(failure)

    await runner.stop()
  })

  it('does not require an onPollError handler', async () => {
    const poll = vi.fn<OutboxPoll>().mockRejectedValue(new Error('db unreachable'))
    const runner = createJobRunner({ poll, clock: createFakeClock(new Date()), intervalMs: 1000 })

    runner.start()
    await vi.advanceTimersByTimeAsync(1000)
    await runner.stop()

    // The missing handler must not have broken the loop: the poll still ran.
    expect(poll).toHaveBeenCalledTimes(1)
  })
})

/**
 * Review finding L4. `inFlight` used to be overwritten on every tick, so a
 * slow poll could be forgotten the moment the next tick began and `stop()`
 * could return with a poll still running — against a pool about to close.
 */
describe('one poll at a time', () => {
  it('skips a tick that arrives while a poll is still running', async () => {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const running = pause()
    const poll = vi.fn<OutboxPoll>().mockImplementation(async () => {
      await running.waited
      return RESULT
    })
    const runner = createJobRunner({ poll, clock, intervalMs: 10 })

    runner.start()
    await vi.advanceTimersByTimeAsync(35)
    // Three ticks fired; the first is still running, so only it called poll.
    expect(poll).toHaveBeenCalledTimes(1)

    running.release()
    const stopping = runner.stop()
    await vi.runOnlyPendingTimersAsync()
    await stopping
  })
})

describe('the lane for slow work', () => {
  const LANE_RESULT: LaneResult = { processed: 1, failed: 0, deferred: 0, deadLettered: 0 }
  const laneConsumer: OutboxConsumer = { eventType: 'Slow', handle: async () => undefined }

  function setUp(pollLane: LanePoll) {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
    const poll = vi.fn<OutboxPoll>().mockResolvedValue(RESULT)
    const onPollError = vi.fn<(error: unknown) => void>()
    const runner = createJobRunner({ poll, pollLane, clock, onPollError })
    return { runner, poll, onPollError }
  }

  it('polls the lane with its own consumers, not the main ones', async () => {
    const pollLane = vi.fn<LanePoll>().mockResolvedValue(LANE_RESULT)
    const { runner, poll } = setUp(pollLane)
    runner.register({ eventType: 'Quick', handle: async () => undefined })
    runner.lane(laneConsumer)

    await runner.pollLaneOnce()
    await runner.pollOnce()
    expect([...(pollLane.mock.calls[0]?.[0].keys() ?? [])]).toEqual(['Slow'])
    expect([...(poll.mock.calls[0]?.[0].keys() ?? [])]).toEqual(['Quick'])
  })

  it('runs on a timer of its own once started', async () => {
    const pollLane = vi.fn<LanePoll>().mockResolvedValue(LANE_RESULT)
    const { runner } = setUp(pollLane)
    runner.lane(laneConsumer)
    runner.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(pollLane.mock.calls.length).toBeGreaterThanOrEqual(3)
    await runner.stop()
  })

  it('does not poll the lane when nothing is on it', async () => {
    const pollLane = vi.fn<LanePoll>().mockResolvedValue(LANE_RESULT)
    const { runner } = setUp(pollLane)
    runner.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(pollLane).not.toHaveBeenCalled()
    await runner.stop()
  })

  it('does not hold up the main poll while a lane cycle is in progress', async () => {
    const held = pause()
    const pollLane = vi.fn<LanePoll>(async () => {
      await held.waited
      return LANE_RESULT
    })
    const { runner, poll } = setUp(pollLane)
    runner.lane(laneConsumer)
    runner.start()
    await vi.advanceTimersByTimeAsync(5000)
    // The lane has been started once and is still working; the main poll kept its pace.
    expect(pollLane).toHaveBeenCalledOnce()
    expect(poll.mock.calls.length).toBeGreaterThanOrEqual(4)
    held.release()
    await runner.stop()
  })

  it('has one lane cycle at a time', async () => {
    const held = pause()
    const pollLane = vi.fn<LanePoll>(async () => {
      await held.waited
      return LANE_RESULT
    })
    const { runner } = setUp(pollLane)
    runner.lane(laneConsumer)
    runner.start()
    await vi.advanceTimersByTimeAsync(4000)
    expect(pollLane).toHaveBeenCalledOnce()
    held.release()
    await runner.stop()
  })

  it('waits for the lane cycle in flight when stopping', async () => {
    const held = pause()
    let finished = false
    const pollLane = vi.fn<LanePoll>(async () => {
      await held.waited
      finished = true
      return LANE_RESULT
    })
    const { runner } = setUp(pollLane)
    runner.lane(laneConsumer)
    runner.start()
    await vi.advanceTimersByTimeAsync(1500)
    const stopping = runner.stop()
    held.release()
    await stopping
    expect(finished).toBe(true)
  })

  it('reports a lane failure and carries on', async () => {
    const pollLane = vi.fn<LanePoll>().mockRejectedValue(new Error('database gone'))
    const { runner, onPollError } = setUp(pollLane)
    runner.lane(laneConsumer)
    runner.start()
    await vi.advanceTimersByTimeAsync(2500)
    expect(onPollError).toHaveBeenCalledWith(expect.objectContaining({ message: 'database gone' }))
    expect(pollLane.mock.calls.length).toBeGreaterThanOrEqual(2)
    await runner.stop()
  })
})
