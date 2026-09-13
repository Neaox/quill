import type pg from 'pg'

import { requireRow } from '../db/rows.ts'
import type { OutboxConsumer } from './consumer.ts'

const DEFAULT_BATCH_SIZE = 10
/** Caps exponential backoff so a persistently failing consumer is retried at most every 5 minutes. */
const MAX_BACKOFF_MS = 5 * 60_000
/**
 * Where retrying stops and the event becomes somebody's problem to look at.
 *
 * With the backoff above, ten attempts is about half an hour of trying. An
 * event that has failed that often is not going to succeed on the eleventh;
 * retrying it for ever costs a claim slot in every batch and buries the
 * failure in a log nobody reads, so it is set aside instead, with its last
 * error, where a query can find it.
 */
export const MAX_OUTBOX_ATTEMPTS = 10

interface OutboxRow {
  id: string
  type: string
  payload: unknown
  attempts: number
}

export interface PollOptions {
  readonly now: Date
  readonly batchSize?: number
}

export interface PollResult {
  readonly processed: number
  readonly failed: number
  /** Events that gave up this cycle, set aside with their last error. */
  readonly deadLettered: number
}

function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS)
}

/**
 * One poll cycle: claims a batch of due, unprocessed events with
 * `FOR UPDATE SKIP LOCKED` (so multiple job runner instances never process
 * the same event twice), dispatches each to its registered consumer, and
 * commits per-event outcomes in the same transaction that claimed them.
 *
 * At-least-once delivery: a consumer failure leaves the event unprocessed
 * with its attempt count bumped and `available_at` pushed out by exponential
 * backoff, so it is retried, not lost — until `MAX_OUTBOX_ATTEMPTS`, at which
 * point it is dead-lettered: stamped with `dead_lettered_at`, never claimed
 * again, and left with its last error for somebody to look at.
 *
 * Only events this process has a consumer for are claimed. An event of a type
 * nothing is registered for is left where it is, for a release that does
 * handle it — and, crucially, is never claimed into a batch: a backlog of
 * events nobody consumes would otherwise fill every batch by age and starve
 * the events that do have a consumer.
 */
export async function pollOutboxOnce(
  pool: pg.Pool,
  consumers: ReadonlyMap<string, OutboxConsumer>,
  options: PollOptions,
): Promise<PollResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, type, payload, attempts FROM outbox_events
       WHERE processed_at IS NULL AND dead_lettered_at IS NULL
         AND available_at <= $1 AND type = ANY($3)
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [options.now, options.batchSize ?? DEFAULT_BATCH_SIZE, [...consumers.keys()]],
    )

    let processed = 0
    let failed = 0
    let deadLettered = 0

    for (const row of rows) {
      // The query claimed only types this map has, so every row has one.
      const consumer = requireRow(consumers.get(row.type), `poll: no consumer for ${row.type}`)
      try {
        await consumer.handle(row.payload)
        // A consumer that handed back a redacted payload gets it stored here:
        // the queued magic link is a live credential until it is delivered,
        // and nothing needs it afterwards (see `send-mail.ts`).
        await client.query(
          'UPDATE outbox_events SET processed_at = $2, payload = $3 WHERE id = $1',
          [row.id, options.now, consumer.redactPayload?.(row.payload) ?? row.payload],
        )
        processed += 1
      } catch (error) {
        const attempts = row.attempts + 1
        const availableAt = new Date(options.now.getTime() + backoffMs(attempts))
        const exhausted = attempts >= MAX_OUTBOX_ATTEMPTS
        await client.query(
          `UPDATE outbox_events
           SET attempts = $2, available_at = $3, last_error = $4, dead_lettered_at = $5
           WHERE id = $1`,
          [
            row.id,
            attempts,
            availableAt,
            error instanceof Error ? error.message : String(error),
            exhausted ? options.now : null,
          ],
        )
        if (exhausted) deadLettered += 1
        else failed += 1
      }
    }

    await client.query('COMMIT')
    return { processed, failed, deadLettered }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
