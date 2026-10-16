/**
 * A consumer handles every outbox event of one type (plan §22): search
 * indexing, effective-permission rebuild, notifications, sync, webhooks,
 * audit. Registered on the job runner by `eventType`.
 */
/**
 * "Not now, and that is nobody's fault": thrown by a consumer that cannot do
 * its work yet (a rate limit, a busy fetcher), so the event is put back for
 * `retryAfterMs` without counting as a failed attempt.
 *
 * Counting it would be wrong twice over. The attempts budget exists to stop an
 * event that keeps *failing* from being retried for ever, and waiting for a
 * token is not failing; and a burst of work behind one slow site would burn
 * through ten attempts each on nothing but queueing and dead-letter good work.
 */
export class DeferEvent extends Error {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number, reason: string) {
    super(`Deferred: ${reason}`)
    this.name = 'DeferEvent'
    this.retryAfterMs = retryAfterMs
  }
}

export interface OutboxConsumer {
  readonly eventType: string
  handle(payload: unknown): Promise<void>
  /**
   * What the processed row should keep instead of what it was handed.
   *
   * A payload is ordinarily worth keeping: it is what an operator reads when
   * something went wrong. A payload carrying a credential is not — the mail
   * consumer's queued magic link is the one case — so a consumer may hand
   * back a redacted form, which the poller stores when it marks the event
   * processed. Omitted, the payload is left exactly as written.
   */
  redactPayload?(payload: unknown): unknown
}
