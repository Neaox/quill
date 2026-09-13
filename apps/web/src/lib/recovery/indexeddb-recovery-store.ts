import { BRAND } from '@quill/brand'
import type { PendingDraft, RecoveryStore } from '@quill/editor'

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
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { expectedVersion?: unknown; savedAt?: unknown }
  return typeof candidate.expectedVersion === 'number' && typeof candidate.savedAt === 'number'
}

export function createIndexedDbRecoveryStore(
  options: IndexedDbRecoveryStoreOptions,
): PersistentRecoveryStore {
  const { documentId, factory } = options
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME

  let entry: PendingDraft | undefined
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

  const ready = connection.then(async (opened) => {
    if (opened === undefined || written) return entry
    const stored = await toPromise(
      opened.transaction(OBJECT_STORE, 'readonly').objectStore(OBJECT_STORE).get(documentId),
    ).catch(() => undefined)
    if (written) return entry
    if (isPendingDraft(stored)) entry = stored
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

  return {
    ready,
    read: () => entry,
    write(next) {
      written = true
      entry = next
      enqueue((store) => store.put(next, documentId))
    },
    clear() {
      written = true
      entry = undefined
      enqueue((store) => store.delete(documentId))
    },
    close() {
      closed = true
      database?.close()
      database = undefined
    },
  }
}
