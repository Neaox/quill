import { BRAND } from '@quill/brand'
import type { DraftBase, PendingDraft, RecoveryStore } from '@quill/editor'

/**
 * The local recovery buffer of ADR-021, in IndexedDB.
 *
 * `@quill/editor` declares the port and ships only an in-memory
 * implementation, because "the client holds unsent changes until they are
 * acknowledged, and resends on reconnection" is a promise only the
 * application can keep: it has to survive a crashed tab, and nothing in the
 * editor package may touch a browser store.
 *
 * The port is synchronous — `useAutosave` reads it in a lazy initialiser on
 * its very first render — and IndexedDB is not, so this keeps the entry in
 * memory and mirrors it to the database. `ready` resolves with whatever a
 * previous session left behind; a caller mounts the editor only once it has,
 * which is what makes an edit written a millisecond before a crash come back
 * on the screen rather than a moment after it was needed.
 *
 * Writes are serialised through one promise chain, so a `clear` can never
 * overtake the `write` it is meant to cancel.
 */

const DATABASE_VERSION = 1
const OBJECT_STORE = 'pending-drafts'

/**
 * What one document's row holds, in the format this release writes. The row
 * is a persisted format, so it carries its version and the reader dispatches
 * on it (ADR-033, AGENTS.md rule 17):
 *
 * - **Format 1** (no `format` field) is the unsent edit itself, as releases
 *   before ADR-021's amendment of 2026-10-11 wrote it. It is read as an edit
 *   with no base, and the merge it might need runs against an empty ancestor:
 *   everything both sides hold is offered, nothing is overwritten.
 *   Those releases kept the base, when they had one, in a row of its own
 *   under `<documentId>#base` ({@link legacyBaseKey}). It is read when the
 *   document's row has no base of its own, then folded into a format 2 row
 *   and deleted, so the base of an edit made on an older release survives
 *   the upgrade.
 * - **Format 2** keeps the unsent edit beside its base — the draft as this
 *   browser last agreed it with the server — so a reconnect can merge three
 *   ways. A row with a base and no edit is kept; one with neither is deleted.
 *
 * The object store and the database version are unchanged: the format lives
 * in the row, so a row is upgraded the next time it is written, and an older
 * release reading a format 2 row finds no edit rather than a wrong one.
 */
const RECORD_FORMAT = 2

interface StoredRecord {
  readonly format: typeof RECORD_FORMAT
  readonly pending?: PendingDraft
  readonly base?: DraftBase
}

/** One database per install, named for the product rather than for a feature. */
const DEFAULT_DATABASE_NAME = `${BRAND.slug}-recovery`

export interface IndexedDbRecoveryStoreOptions {
  /** One entry per document: two open documents recover independently. */
  readonly documentId: string
  /** Injected so a test can supply a fake, and so a browser without one is a value rather than a crash. */
  readonly factory: IDBFactory | undefined
  readonly databaseName?: string
}

export interface PersistentRecoveryStore extends RecoveryStore {
  /**
   * Resolves with the entry a previous session left unsent, or `undefined`
   * when there is none — including when IndexedDB is unavailable, which is a
   * degraded buffer rather than a broken editor.
   */
  readonly ready: Promise<PendingDraft | undefined>
  /** Releases the connection. Idempotent. */
  close(): void
}

/** Promisifies one `IDBRequest`. Rejection carries the database's own error. */
function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result)
    })
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB request failed'))
    })
  })
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  const request = factory.open(name, DATABASE_VERSION)
  request.addEventListener('upgradeneeded', () => {
    if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
      request.result.createObjectStore(OBJECT_STORE)
    }
  })
  return toPromise(request)
}

function isPendingDraft(value: unknown): value is PendingDraft {
  return (
    typeof value === 'object' &&
    value !== null &&
    'expectedVersion' in value &&
    typeof value.expectedVersion === 'number' &&
    'savedAt' in value &&
    typeof value.savedAt === 'number'
  )
}

function isDraftBase(value: unknown): value is DraftBase {
  return (
    typeof value === 'object' &&
    value !== null &&
    'draftVersion' in value &&
    typeof value.draftVersion === 'number' &&
    'ast' in value &&
    typeof value.ast === 'object' &&
    value.ast !== null
  )
}

/** Where releases before row format 2 kept a document's base, as a bare `DraftBase`. */
function legacyBaseKey(documentId: string): string {
  return `${documentId}#base`
}

interface RecoveredRow {
  readonly pending: PendingDraft | undefined
  readonly base: DraftBase | undefined
}

/** A stored row, whichever format wrote it. */
export function readRow(value: unknown): RecoveredRow {
  if (typeof value === 'object' && value !== null && 'format' in value) {
    if (value.format !== RECORD_FORMAT) return { pending: undefined, base: undefined }
    const pending = 'pending' in value && isPendingDraft(value.pending) ? value.pending : undefined
    const base = 'base' in value && isDraftBase(value.base) ? value.base : undefined
    return { pending, base }
  }
  return { pending: isPendingDraft(value) ? value : undefined, base: undefined }
}

export function createIndexedDbRecoveryStore(
  options: IndexedDbRecoveryStoreOptions,
): PersistentRecoveryStore {
  const { documentId, factory } = options
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME

  let entry: PendingDraft | undefined
  let base: DraftBase | undefined
  // A write that happens while the database is still opening must win: the
  // author's current edit is never replaced by one recovered from disk.
  let written = false
  let closed = false
  let database: IDBDatabase | undefined
  let queue: Promise<unknown> = Promise.resolve()

  const connection =
    factory === undefined
      ? Promise.resolve(undefined)
      : openDatabase(factory, databaseName).then(
          (opened) => {
            if (closed) {
              opened.close()
              return undefined
            }
            database = opened
            return opened
          },
          // A blocked or refused database (private browsing, a quota
          // refusal) degrades to the in-memory buffer rather than failing
          // the editor: losing the crash-recovery guarantee is bad, losing
          // the editing session is worse.
          () => undefined,
        )

  /** One read of a key, which a refused read answers with nothing. */
  const load = (opened: IDBDatabase, key: string): Promise<unknown> =>
    toPromise(
      opened.transaction(OBJECT_STORE, 'readonly').objectStore(OBJECT_STORE).get(key),
    ).catch(() => undefined)

  const ready = connection.then(async (opened) => {
    if (opened === undefined) return entry
    const [stored, legacyBase] = await Promise.all([
      load(opened, documentId),
      load(opened, legacyBaseKey(documentId)),
    ])
    const row = readRow(stored)
    // A base written while the database was opening is newer than either.
    base ??= row.base ?? (isDraftBase(legacyBase) ? legacyBase : undefined)
    if (!written) entry = row.pending
    if (legacyBase !== undefined) mirror([legacyBaseKey(documentId)])
    return entry
  })

  /** Runs `mutate` against the store once the connection is known, in write order. */
  function enqueue(mutate: (store: IDBObjectStore) => IDBRequest): void {
    queue = queue
      .then(async () => {
        await connection
        if (database === undefined || closed) return
        await toPromise(
          mutate(database.transaction(OBJECT_STORE, 'readwrite').objectStore(OBJECT_STORE)),
        )
      })
      .catch(() => {
        // A failed mirror leaves the in-memory buffer intact and the editor
        // running; there is nothing useful to tell the author about it.
      })
  }

  /**
   * Mirrors the edit and the base as one row, so the two never disagree on
   * disk, and deletes `superseded` rows in the same transaction: a migrated
   * row goes only once what it held is written.
   */
  function mirror(superseded: readonly string[] = []): void {
    const row: StoredRecord = {
      format: RECORD_FORMAT,
      ...(entry === undefined ? {} : { pending: entry }),
      ...(base === undefined ? {} : { base }),
    }
    enqueue((store) => {
      const request =
        entry === undefined && base === undefined
          ? store.delete(documentId)
          : store.put(row, documentId)
      for (const key of superseded) store.delete(key)
      return request
    })
  }

  return {
    ready,
    read: () => entry,
    write(next) {
      written = true
      entry = next
      mirror()
    },
    clear() {
      written = true
      entry = undefined
      mirror()
    },
    readBase: () => base,
    writeBase(next) {
      base = next
      mirror()
    },
    close() {
      closed = true
      database?.close()
      database = undefined
    },
  }
}
