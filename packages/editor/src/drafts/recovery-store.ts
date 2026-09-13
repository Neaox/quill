import type { DocumentAst } from './clients.ts'

/**
 * One unsent edit, keyed by the draft version it was based on (R5, "Client
 * recovery flow"). `savedAt` is when it entered the buffer, not when the server
 * acknowledged it — nothing here has reached the server yet.
 */
export interface PendingDraft {
  readonly ast: DocumentAst
  readonly expectedVersion: number
  readonly savedAt: number
}

/**
 * Holds the unsent draft until the server acknowledges it, so a crash or a closed
 * tab between the buffer write and the response still leaves the edit recoverable.
 * The web app supplies the IndexedDB implementation ADR-021 calls for; this package
 * only depends on the interface so the hooks stay testable without a browser store.
 */
export interface RecoveryStore {
  read(): PendingDraft | undefined
  write(entry: PendingDraft): void
  clear(): void
}

/** An in-memory store for tests and for callers with no persistence of their own. */
export function createMemoryRecoveryStore(initial?: PendingDraft): RecoveryStore {
  let entry = initial
  return {
    read: () => entry,
    write: (next) => {
      entry = next
    },
    clear: () => {
      entry = undefined
    },
  }
}
