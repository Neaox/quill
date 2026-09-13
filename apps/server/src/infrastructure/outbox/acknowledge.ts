import type { OutboxConsumer } from './consumer.ts'

/**
 * A consumer that does nothing, deliberately.
 *
 * The poller only claims events of types it has a consumer for, which is what
 * keeps a backlog of unconsumed events from filling every batch by age and
 * starving the ones that matter (review finding H6). The other half of that
 * rule is this: an event type nothing acts on yet still needs *somebody* to
 * mark it processed, or `outbox_events` grows for ever with rows no release
 * will ever claim.
 *
 * `DocumentCreated` is the case today — it exists for the search index that
 * arrives later — and registering this says so out loud, with the reason
 * attached, rather than leaving a reader to wonder whether a consumer was
 * forgotten.
 */
export interface AcknowledgingConsumer extends OutboxConsumer {
  /** Why nothing acts on this event type yet. */
  readonly reason: string
}

export function createAcknowledgingConsumer(
  eventType: string,
  reason: string,
): AcknowledgingConsumer {
  return {
    eventType,
    reason,
    async handle(): Promise<void> {
      // Nothing to do: acknowledging the event is the whole behaviour.
    },
  }
}
