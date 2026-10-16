import type { Clock } from '@quill/application'

import type { OutboxConsumer } from '../infrastructure/outbox/consumer.ts'
import type { LaneResult } from '../infrastructure/outbox/lane.ts'
import type { PollResult } from '../infrastructure/outbox/poller.ts'

/**
 * The DB polling mechanics (`pollOutboxOnce`) are injected as a plain
 * function so the scheduling loop below — register, start, stop, poll now —
 * is unit-testable without a real Postgres connection.
 */
export type OutboxPoll = (
  consumers: ReadonlyMap<string, OutboxConsumer>,
  now: Date,
) => Promise<PollResult>

/** Polls one lane (`infrastructure/outbox/lane.ts`): work that waits on other servers. */
export type LanePoll = (
  consumers: ReadonlyMap<string, OutboxConsumer>,
  now: Date,
) => Promise<LaneResult>

export interface JobRunnerOptions {
  readonly poll: OutboxPoll
  /** Polls the lane that `lane()` consumers run on. Required if any is registered. */
  readonly pollLane?: LanePoll
  readonly clock: Clock
  /** Time between poll cycles while running. Defaults to 1000ms. */
  readonly intervalMs?: number
  /** Called with a poll failure that isn't a consumer failure (e.g. the DB dropped mid-poll); never thrown into the loop. */
  readonly onPollError?: (error: unknown) => void
}

/**
 * Housekeeping that is not an outbox event: expired sessions and spent
 * magic-link tokens (ADR-011). It runs on the same timer as the poller
 * rather than bringing a second process, and takes `now` for the same reason
 * everything else here does — a test drives it with the fake clock.
 */
export interface ScheduledJob {
  readonly name: string
  readonly intervalMs: number
  run(now: Date): Promise<void>
}

export interface JobRunner {
  register(consumer: OutboxConsumer): void
  /**
   * Registers a consumer on the lane for slow work on other people's servers.
   * It runs beside the main poll and never inside it, so a slow site cannot
   * delay a publish or a mail, and the main poller never claims its events.
   */
  lane(consumer: OutboxConsumer): void
  /** Adds a periodic job. Its first run is one interval after `start()`. */
  schedule(job: ScheduledJob): void
  start(): void
  /** Stops scheduling further polls and waits for any in-flight poll to finish (clean shutdown, plan §22). */
  stop(): Promise<void>
  /** Runs one poll cycle immediately, outside the schedule; used by tests and manual triggers. */
  pollOnce(): Promise<PollResult>
  /** Runs one cycle of the lane immediately; used by tests and manual triggers. */
  pollLaneOnce(): Promise<LaneResult>
  /** Runs every scheduled job that is due, outside the timer; used by tests and manual triggers. */
  runDueJobs(): Promise<readonly string[]>
}

/** A small in-process job runner polling the outbox on an interval (plan §22). */
export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const consumers = new Map<string, OutboxConsumer>()
  const laneConsumers = new Map<string, OutboxConsumer>()
  let laneInFlight: Promise<void> | null = null
  let laneTimer: ReturnType<typeof setInterval> | null = null
  const scheduled: { readonly job: ScheduledJob; dueAt: number }[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<void> | null = null

  /**
   * Every job whose interval has elapsed, in order, reporting which ran.
   *
   * A job that throws is logged through the same sink a poll failure uses and
   * does not stop the ones after it: housekeeping failing must not take the
   * outbox down with it.
   */
  async function runDue(now: Date): Promise<readonly string[]> {
    const ran: string[] = []
    for (const entry of scheduled) {
      if (now.getTime() < entry.dueAt) continue
      entry.dueAt = now.getTime() + entry.job.intervalMs
      try {
        // In sequence deliberately: these share one connection pool with the
        // poll that just ran, and housekeeping must never crowd it out.
        await entry.job.run(now)
        ran.push(entry.job.name)
      } catch (error) {
        options.onPollError?.(error)
      }
    }
    return ran
  }

  /**
   * One poll at a time, and `stop()` always has the right one to wait for.
   *
   * Overwriting a single `inFlight` on every tick meant a slow poll could be
   * forgotten the moment the next tick started, so shutdown could return with
   * a poll still running and the connection closed under it. A tick that
   * arrives while one is running is skipped rather than queued: the next one
   * is a second away and the outbox is claimed with `FOR UPDATE SKIP LOCKED`,
   * so nothing is lost by waiting.
   */
  async function tick(): Promise<void> {
    if (inFlight !== null) return
    const running = (async () => {
      const now = options.clock.now()
      try {
        await options.poll(consumers, now)
      } catch (error) {
        options.onPollError?.(error)
      }
      await runDue(now)
    })()
    inFlight = running
    try {
      await running
    } finally {
      inFlight = null
    }
  }

  /**
   * One lane cycle at a time, on its own clock. It is deliberately not part of
   * `tick`: that waits for the main poll and then for each scheduled job, and a
   * lane cycle may legitimately take half a minute.
   */
  async function laneTick(): Promise<void> {
    if (laneInFlight !== null || laneConsumers.size === 0) return
    const running = (async () => {
      try {
        await options.pollLane?.(laneConsumers, options.clock.now())
      } catch (error) {
        options.onPollError?.(error)
      }
    })()
    laneInFlight = running
    try {
      await running
    } finally {
      laneInFlight = null
    }
  }

  return {
    register(consumer: OutboxConsumer): void {
      consumers.set(consumer.eventType, consumer)
    },

    lane(consumer: OutboxConsumer): void {
      laneConsumers.set(consumer.eventType, consumer)
    },

    schedule(job: ScheduledJob): void {
      scheduled.push({ job, dueAt: options.clock.now().getTime() + job.intervalMs })
    },

    start(): void {
      if (timer !== null) {
        return
      }
      timer = setInterval(() => {
        void tick()
      }, options.intervalMs ?? 1000)
      timer.unref()
      laneTimer = setInterval(() => {
        void laneTick()
      }, options.intervalMs ?? 1000)
      laneTimer.unref()
    },

    async stop(): Promise<void> {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      if (laneTimer !== null) {
        clearInterval(laneTimer)
        laneTimer = null
      }
      await Promise.all([inFlight, laneInFlight])
    },

    pollOnce(): Promise<PollResult> {
      return options.poll(consumers, options.clock.now())
    },

    pollLaneOnce(): Promise<LaneResult> {
      /* v8 ignore next 3 -- a runner with a lane consumer is always given the poll that serves it. */
      if (options.pollLane === undefined) {
        throw new Error('The job runner has a lane consumer but no pollLane')
      }
      return options.pollLane(laneConsumers, options.clock.now())
    },

    runDueJobs(): Promise<readonly string[]> {
      return runDue(options.clock.now())
    },
  }
}
