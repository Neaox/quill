/**
 * A consumer handles every outbox event of one type (plan §22): search
 * indexing, effective-permission rebuild, notifications, sync, webhooks,
 * audit. Registered on the job runner by `eventType`.
 */
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
