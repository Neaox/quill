/**
 * Reading a persisted format by dispatching on its version (ADR-033).
 *
 * Every format this platform writes carries a version, and every reader
 * accepts every version ever shipped rather than only the current one: a
 * draft, an outbox payload, or a cached body written by one release is read by
 * a later one. A reader is registered per version, so shipping version 2 is
 * adding an entry beside version 1 and never editing version 1's reader.
 *
 * Strict equality with the current version is the bug this replaces: it turns
 * every older record into "unreadable", which is exactly the regression the
 * compatibility policy forbids.
 */

/**
 * Turns one version's stored shape into the value this release works with, or
 * null when the record is malformed. The value has already been established as
 * an object carrying this version.
 */
export type VersionReader<T> = (value: unknown) => T | null

export interface VersionedReader<T> {
  /** The version this release writes: the highest one registered. */
  readonly current: number
  /** The value, or null when nothing shipped can read this record. */
  read(value: unknown): T | null
}

/**
 * A reader over the versions in `readers`, the highest of which is the one
 * this release writes. A record whose version is unknown — a newer release
 * wrote it — reads as null, so it is left for a release that understands it
 * rather than being guessed at.
 */
export function createVersionedReader<T>(
  readers: Readonly<Record<number, VersionReader<T>>>,
): VersionedReader<T> {
  const current = Math.max(...Object.keys(readers).map(Number))

  return {
    current,
    read(value: unknown): T | null {
      if (typeof value !== 'object' || value === null) return null
      const version = (value as { version?: unknown }).version
      if (typeof version !== 'number') return null
      const reader = readers[version]
      return reader === undefined ? null : reader(value)
    },
  }
}
