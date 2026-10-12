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
  /**
   * The edit is a merge of this author's offline changes into somebody else's
   * draft (ADR-021, amendment of 2026-10-11): the save says so, so the other
   * author is told on their next load.
   */
  readonly merged?: boolean
}

/**
 * The draft as it was when this editor last agreed with the server: the tree
 * the last acknowledged save sent, or the one loaded at open (ADR-021,
 * amendment of 2026-10-11). It is the common ancestor of a three-way merge
 * between the unsent edit and whatever the server holds by the time the
 * editor is back, so it is kept beside the edit and replaced on every
 * acknowledgement.
 */
export interface DraftBase {
  readonly ast: DocumentAst
  readonly draftVersion: number
}

/**
 * Holds the unsent draft until the server acknowledges it, so a crash or a closed
 * tab between the buffer write and the response still leaves the edit recoverable,
 * and the base it was written on, so it can be merged rather than overwritten.
 * The web app supplies the IndexedDB implementation ADR-021 calls for; this package
 * only depends on the interface so the hooks stay testable without a browser store.
 */
export interface RecoveryStore {
  read(): PendingDraft | undefined
  write(entry: PendingDraft): void
  clear(): void
  readBase(): DraftBase | undefined
  writeBase(base: DraftBase): void
}

/** An in-memory store for tests and for callers with no persistence of their own. */
export function createMemoryRecoveryStore(initial?: PendingDraft, base?: DraftBase): RecoveryStore {
  let entry = initial
  let agreed = base
  return {
    read: () => entry,
    write: (next) => {
      entry = next
    },
    clear: () => {
      entry = undefined
    },
    readBase: () => agreed,
    writeBase: (next) => {
      agreed = next
    },
  }
}
