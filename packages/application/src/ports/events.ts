import type { EventDefinition, EventPayloadInput } from '../events/define-event.ts'

/**
 * The two ports of the event system (ADR-056), declared with the other ports
 * because the application layer depends on them and not on how they are
 * implemented: a use case records an event, and what is told about it is not
 * its concern.
 */

/** What was committed: the outbox row's type and payload, without the row. */
export interface RecordedEvent {
  readonly type: string
  readonly payload: unknown
}

/**
 * The in-process half: an Observer, in the shape the patterns catalogue names,
 * `subscribe` returning the unsubscribe.
 *
 * It is a signal that a commit happened and never a record of it. The outbox
 * is the record; this tells the *same process* quickly, which is what a cache
 * wants and what a once-only consumer cannot give. A listener that must not be
 * lost is an outbox consumer instead.
 */
export interface EventBus {
  /** The listener is handed the payload typed by the definition. Returns the unsubscribe. */
  subscribe<P extends { readonly version: number }>(
    definition: EventDefinition<P>,
    listener: (payload: P) => void | Promise<void>,
  ): () => void
  /**
   * Delivers to each subscriber of the event's type, in the order they
   * subscribed, waiting for each. Never rejects: the change being announced
   * has already been committed, so a failing listener is reported, not allowed
   * to fail the request that made it.
   */
  publish(event: RecordedEvent): Promise<void>
}

/**
 * The one way a use case emits an event.
 *
 * Writing the outbox row and telling the process are two things that must
 * both happen, in that order, and a caller that is handed both separately can
 * do one and forget the other. So it is handed one: `record` writes the row in
 * the caller's transaction and then gives the event to the unit of work, which
 * publishes it to the bus only once that transaction has committed.
 */
export interface EventRecorder {
  record<P extends { readonly version: number }>(
    definition: EventDefinition<P>,
    payload: EventPayloadInput<P>,
    now: Date,
  ): Promise<void>
}
