import type { Clock } from '@quill/application'

import type { OutboxConsumer } from '../infrastructure/outbox/consumer.ts'
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

export interface JobRunnerOptions {
  readonly poll: OutboxPoll
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
  /** Adds a periodic job. Its first run is one interval after `start()`. */
  schedule(job: ScheduledJob): void
  start(): void
  /** Stops scheduling further polls and waits for any in-flight poll to finish (clean shutdown, plan §22). */
  stop(): Promise<void>
  /** Runs one poll cycle immediately, outside the schedule; used by tests and manual triggers. */
  pollOnce(): Promise<PollResult>
  /** Runs every scheduled job that is due, outside the timer; used by tests and manual triggers. */
  runDueJobs(): Promise<readonly string[]>
}

/** A small in-process job runner polling the outbox on an interval (plan §22). */
export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const consumers = new Map<string, OutboxConsumer>()
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

  return {
    register(consumer: OutboxConsumer): void {
      consumers.set(consumer.eventType, consumer)
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
    },

    async stop(): Promise<void> {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      await inFlight
    },

    pollOnce(): Promise<PollResult> {
      return options.poll(consumers, options.clock.now())
    },

    runDueJobs(): Promise<readonly string[]> {
      return runDue(options.clock.now())
    },
  }
}
