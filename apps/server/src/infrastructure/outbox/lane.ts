import type pg from 'pg'

import { requireRow } from '../db/rows.ts'
import { DeferEvent } from './consumer.ts'
import type { OutboxConsumer } from './consumer.ts'
import { failedAttempt } from './poller.ts'

/**
 * A lane of the outbox for work that waits on other people's servers (ADR-042).
 *
 * The main poller (`poller.ts`) is the right shape for work that is quick and
 * ours: it claims a batch, runs it one event at a time, and does so inside the
 * transaction that claimed it. Link previews are neither. A fetch waits up to
 * several seconds on a stranger's server, so on that poller a handful of slow
 * sites would hold up rendering a publish and delivering mail behind them, and
 * would hold a database connection and row locks all the while.
 *
 * A lane differs in three ways:
 * - **A lease, not a held transaction.** Claiming is short: due events are
 *   locked, pushed out by `leaseMs`, and the transaction ends. The work then
 *   runs with no connection held, and a crash mid-work only means the lease
 *   runs out and the event is claimed again (at-least-once, as before).
 * - **Bounded parallelism.** Up to `concurrency` events run at once, so the
 *   lane keeps the fetcher busy without opening more sockets than it allows.
 * - **Deferral is not failure.** A consumer that throws `DeferEvent` puts the
 *   event back for the time it names, with a little jitter so events deferred
 *   together do not all return together, and the attempt is not counted.
 *
 * Every other outcome is as on the main poller: processed (with the payload
 * redacted if the consumer says so), or a failed attempt with backoff and a
 * dead letter at the limit.
 */

const DEFAULT_CONCURRENCY = 8
const DEFAULT_BATCH_SIZE = 16
/** Longer than any one fetch can take; an event whose worker died is claimed again after this. */
const DEFAULT_LEASE_MS = 2 * 60_000
/** A fetch that has not finished by now is a failed attempt, not a reason to hold a slot. */
const DEFAULT_HANDLER_TIMEOUT_MS = 60_000
/** Deferrals vary by up to this fraction, either way. */
const JITTER = 0.25

export interface LaneOptions {
  readonly now: Date
  readonly concurrency?: number
  readonly batchSize?: number
  readonly leaseMs?: number
  readonly handlerTimeoutMs?: number
  /** In [0, 1); injected so a test is exact. */
  readonly random?: () => number
}

export interface LaneResult {
  readonly processed: number
  readonly failed: number
  readonly deferred: number
  readonly deadLettered: number
}

interface LaneRow {
  id: string
  type: string
  payload: unknown
  attempts: number
}

function jittered(ms: number, random: () => number): number {
  return Math.max(1, Math.round(ms * (1 - JITTER + random() * 2 * JITTER)))
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`No result within ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([work, expired])
  } finally {
    clearTimeout(timer)
  }
}

/** Locks the due events of these types and leases them, so no one else takes them while they run. */
async function claim(
  pool: pg.Pool,
  types: readonly string[],
  options: LaneOptions,
): Promise<readonly LaneRow[]> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<LaneRow>(
      `SELECT id, type, payload, attempts FROM outbox_events
       WHERE processed_at IS NULL AND dead_lettered_at IS NULL
         AND available_at <= $1 AND type = ANY($3)
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [options.now, options.batchSize ?? DEFAULT_BATCH_SIZE, [...types]],
    )
    if (rows.length > 0) {
      await client.query('UPDATE outbox_events SET available_at = $2 WHERE id = ANY($1)', [
        rows.map((row) => row.id),
        new Date(options.now.getTime() + (options.leaseMs ?? DEFAULT_LEASE_MS)),
      ])
    }
    await client.query('COMMIT')
    return rows
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function pollOutboxLane(
  pool: pg.Pool,
  consumers: ReadonlyMap<string, OutboxConsumer>,
  options: LaneOptions,
): Promise<LaneResult> {
  const rows = await claim(pool, [...consumers.keys()], options)
  const random = options.random ?? Math.random
  const timeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS
  const tally = { processed: 0, failed: 0, deferred: 0, deadLettered: 0 }

  async function run(row: LaneRow): Promise<void> {
    // The claim selected only types this map has.
    const consumer = requireRow(consumers.get(row.type), `lane: no consumer for ${row.type}`)
    try {
      await withTimeout(consumer.handle(row.payload), timeoutMs)
      await pool.query('UPDATE outbox_events SET processed_at = $2, payload = $3 WHERE id = $1', [
        row.id,
        options.now,
        consumer.redactPayload?.(row.payload) ?? row.payload,
      ])
      tally.processed += 1
    } catch (error) {
      if (error instanceof DeferEvent) {
        await pool.query(
          'UPDATE outbox_events SET available_at = $2, last_error = $3 WHERE id = $1',
          [
            row.id,
            new Date(options.now.getTime() + jittered(error.retryAfterMs, random)),
            error.message,
          ],
        )
        tally.deferred += 1
        return
      }
      const failure = failedAttempt(row, error, options.now)
      await pool.query(failure.sql, [...failure.params])
      if (failure.exhausted) tally.deadLettered += 1
      else tally.failed += 1
    }
  }

  // A small pool of workers, each taking the next event as it finishes one:
  // first-come order, never more than `concurrency` at once.
  const waiting = [...rows]
  const workers = Array.from(
    { length: Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, rows.length) },
    async () => {
      for (let row = waiting.shift(); row !== undefined; row = waiting.shift()) {
        // eslint-disable-next-line no-await-in-loop -- a worker takes its events one after another.
        await run(row)
      }
    },
  )
  // Every worker finishes before this reports; the first bookkeeping failure (the database
  // went away mid-batch) is then raised, and the leases bring the rest back.
  const settled = await Promise.allSettled(workers)
  const broken = settled.find((outcome) => outcome.status === 'rejected')
  if (broken !== undefined) throw broken.reason
  return tally
}
