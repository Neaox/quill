import { createVersionedReader } from '../use-cases/versioned-reader.ts'
import type { VersionReader } from '../use-cases/versioned-reader.ts'

/**
 * An event, defined once (ADR-052).
 *
 * The type name, the version this release writes, and the reader for every
 * version ever shipped (ADR-033) are one value, so the constant, the parse
 * function and the payload type that used to be written out by hand for each
 * event all come from it. Adding an event is adding one `defineEvent`.
 */
export interface EventDefinition<P extends { readonly version: number }> {
  readonly type: string
  /** The version this release writes: the highest a reader is registered for. */
  readonly version: number
  /**
   * Whether the bus is told. An event whose payload carries a credential is
   * recorded in the outbox, where the one consumer that needs it reads it and
   * redacts it, and is never put on a channel any subscriber may listen to.
   */
  readonly announced: boolean
  /** The payload, or null when nothing shipped can read it. A newer release's event is left for it. */
  parse(payload: unknown): P | null
}

/**
 * What a caller supplies when recording: the payload without its version,
 * which the recorder stamps. Distributes over a union so a payload with
 * variants (`MailRequested`) keeps each variant's own fields.
 */
export type EventPayloadInput<P extends { readonly version: number }> = P extends unknown
  ? Omit<P, 'version'>
  : never

export interface EventOptions {
  /** True unless the payload carries a credential; see {@link EventDefinition.announced}. */
  readonly announced?: boolean
}

export function defineEvent<P extends { readonly version: number }>(
  type: string,
  readers: Readonly<Record<number, VersionReader<P>>>,
  options: EventOptions = {},
): EventDefinition<P> {
  const reader = createVersionedReader<P>(readers)
  return {
    type,
    version: reader.current,
    announced: options.announced ?? true,
    parse: (payload) => reader.read(payload),
  }
}
