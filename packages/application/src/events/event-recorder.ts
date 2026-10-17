import type { OutboxWriter } from '../ports/persistence.ts'
import type { IdGenerator } from '../ports/system.ts'
import type { EventRecorder, RecordedEvent } from '../ports/events.ts'

/**
 * The recorder (ADR-052), implementing the `EventRecorder` port.
 */
export interface EventRecorderDependencies {
  /** Bound to the same transaction as the change the event reports. */
  readonly outbox: OutboxWriter
  readonly ids: Pick<IdGenerator, 'uuid'>
  /** Where a written event goes to await its commit: the unit of work's, never the bus's directly. */
  readonly sink: (event: RecordedEvent) => void
}

export function createEventRecorder(deps: EventRecorderDependencies): EventRecorder {
  return {
    async record(definition, payload, now) {
      const stamped = { ...payload, version: definition.version }
      await deps.outbox.write({
        id: deps.ids.uuid(),
        type: definition.type,
        payload: stamped,
        now,
      })
      if (definition.announced) deps.sink({ type: definition.type, payload: stamped })
    },
  }
}
