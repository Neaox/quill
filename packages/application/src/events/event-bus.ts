import type { EventBus, RecordedEvent } from '../ports/events.ts'

/**
 * The in-process bus (ADR-056), implementing the `EventBus` port.
 */

export interface EventBusOptions {
  /** Where a listener's failure goes: the logger, in the server. */
  readonly onError: (error: unknown, event: RecordedEvent) => void
}

type Delivery = (event: RecordedEvent) => Promise<void>

export function createEventBus(options: EventBusOptions): EventBus {
  const deliveries = new Map<string, Set<Delivery>>()

  return {
    subscribe(definition, listener) {
      const delivery: Delivery = async (event) => {
        // An event this release cannot read is left for one that can (ADR-033).
        const payload = definition.parse(event.payload)
        if (payload === null) return
        try {
          await listener(payload)
        } catch (error) {
          options.onError(error, event)
        }
      }
      const forType = deliveries.get(definition.type) ?? new Set<Delivery>()
      forType.add(delivery)
      deliveries.set(definition.type, forType)
      return () => {
        forType.delete(delivery)
      }
    },

    async publish(event) {
      // A copy, so a listener that unsubscribes does not skip the one after it.
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- listeners are delivered in the order they subscribed, each awaited before the next (the bus's contract)
      for (const delivery of Array.from(deliveries.get(event.type) ?? [])) {
        await delivery(event)
      }
    },
  }
}
