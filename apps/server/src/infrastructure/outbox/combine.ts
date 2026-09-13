import type { OutboxConsumer } from './consumer.ts'

/**
 * Several consumers of one event type, as the single consumer the job runner
 * registers.
 *
 * The runner keys its registry by `eventType` (plan §22), because the poller
 * claims only the types something is registered for. That is the right shape
 * for claiming and the wrong shape for the moment a second thing needs to
 * happen on a publish: registering the search indexer beside the renderer
 * would silently replace it. Saying "both, in this order" out loud is
 * clearer than teaching the registry to hold lists and leaving the order it
 * runs them in implicit.
 *
 * They run in order and the first failure stops the rest, so the event is
 * retried whole — which is safe because every consumer here is idempotent, as
 * at-least-once delivery requires of all of them anyway. `redactPayload` is
 * applied by each consumer that defines one, in the same order, so a payload
 * one of them wants redacted is redacted whatever else looks at it.
 */
export function combineConsumers(
  eventType: string,
  ...consumers: readonly OutboxConsumer[]
): OutboxConsumer {
  const mismatched = consumers.find((consumer) => consumer.eventType !== eventType)
  if (mismatched !== undefined) {
    throw new Error(
      `combineConsumers(${eventType}) was given a consumer for ${mismatched.eventType}`,
    )
  }

  return {
    eventType,

    async handle(payload: unknown): Promise<void> {
      for (const consumer of consumers) await consumer.handle(payload)
    },

    redactPayload(payload: unknown): unknown {
      return consumers.reduce(
        (redacted, consumer) => consumer.redactPayload?.(redacted) ?? redacted,
        payload,
      )
    },
  }
}
