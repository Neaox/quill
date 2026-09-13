import { describe, expect, it, vi } from 'vitest'

import type { PendingDraft } from '@quill/editor'

import { createIndexedDbRecoveryStore } from './indexeddb-recovery-store.ts'

/**
 * A fake IndexedDB, small enough to read and real enough to be worth
 * testing against: requests are event targets that settle on a microtask,
 * exactly like the real thing, which is what makes the ordering this module
 * depends on (open, then read back, then mirror every write in order)
 * actually exercised rather than assumed.
 */
class FakeRequest<T> extends EventTarget {
  result!: T
  error: Error | null = null

  settle(work: () => T, upgrade?: () => void): this {
    queueMicrotask(() => {
      try {
        if (upgrade !== undefined) {
          upgrade()
          this.dispatchEvent(new Event('upgradeneeded'))
        }
        this.result = work()
        this.dispatchEvent(new Event('success'))
      } catch (error) {
        this.error = error instanceof Error ? error : new Error(String(error))
        this.dispatchEvent(new Event('error'))
      }
    })
    return this
  }
}

interface FakeOptions {
  /** Rejects `open`, as a browser in private mode or out of quota does. */
  readonly refuseToOpen?: boolean
  /** Fails every write, as a quota refusal mid-session does. */
  readonly refuseWrites?: boolean
}

function createFakeIndexedDb(
  rows: Map<string, unknown> = new Map(),
  options: FakeOptions = {},
): { factory: IDBFactory; rows: Map<string, unknown>; isOpen: () => boolean } {
  let open = false
  const stores = new Set<string>()

  const objectStore = {
    get: (key: string) => new FakeRequest<unknown>().settle(() => rows.get(key)),
    put: (value: unknown, key: string) =>
      new FakeRequest<unknown>().settle(() => {
        if (options.refuseWrites === true) throw new Error('Quota exceeded')
        rows.set(key, value)
        return undefined
      }),
    delete: (key: string) =>
      new FakeRequest<unknown>().settle(() => {
        rows.delete(key)
        return undefined
      }),
  }

  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      stores.add(name)
      return objectStore
    },
    transaction: () => ({ objectStore: () => objectStore }),
    close: () => {
      open = false
    },
  }

  const factory = {
    open: () =>
      new FakeRequest<unknown>().settle(
        () => {
          if (options.refuseToOpen === true) throw new Error('Refused')
          open = true
          return database
        },
        () => {
          if (options.refuseToOpen !== true) stores.add('pending-drafts')
        },
      ),
  }

  // The fake implements exactly the slice of `IDBFactory` this module uses;
  // the cast is the boundary of that, and every member it reaches for is
  // above.
  return { factory: factory as unknown as IDBFactory, rows, isOpen: () => open }
}

const EDIT: PendingDraft = {
  ast: { type: 'root', children: [] },
  expectedVersion: 4,
  savedAt: 1_700_000_000_000,
}

describe('createIndexedDbRecoveryStore', () => {
  it('hands back the edit a previous session never managed to send', async () => {
    const { factory } = createFakeIndexedDb(new Map([['doc-1', EDIT]]))
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })

    expect(await store.ready).toEqual(EDIT)
    expect(store.read()).toEqual(EDIT)
  })

  it('recovers nothing for a document nobody has edited', async () => {
    const { factory } = createFakeIndexedDb(new Map([['doc-other', EDIT]]))
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })

    expect(await store.ready).toBeUndefined()
  })

  it('mirrors a write to the database and reads it back immediately', async () => {
    const { factory, rows } = createFakeIndexedDb()
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    await store.ready

    store.write(EDIT)

    // The buffer answers straight away; the mirror catches up.
    expect(store.read()).toEqual(EDIT)
    await vi.waitFor(() => {
      expect(rows.get('doc-1')).toEqual(EDIT)
    })
  })

  it('clears the mirror when the server acknowledges the edit', async () => {
    const { factory, rows } = createFakeIndexedDb(new Map([['doc-1', EDIT]]))
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    await store.ready

    store.clear()

    expect(store.read()).toBeUndefined()
    await vi.waitFor(() => {
      expect(rows.has('doc-1')).toBe(false)
    })
  })

  it('never lets a recovered edit overwrite one the author is making now', async () => {
    const { factory } = createFakeIndexedDb(new Map([['doc-1', EDIT]]))
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })

    // Typed before the database finished opening.
    const typing: PendingDraft = { ...EDIT, expectedVersion: 5, savedAt: EDIT.savedAt + 1 }
    store.write(typing)

    expect(await store.ready).toEqual(typing)
    expect(store.read()).toEqual(typing)
  })

  it('keeps the editor working when the browser refuses a database at all', async () => {
    const { factory } = createFakeIndexedDb(new Map(), { refuseToOpen: true })
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })

    expect(await store.ready).toBeUndefined()

    store.write(EDIT)
    expect(store.read()).toEqual(EDIT)
  })

  it('keeps the buffer when a write to the database fails', async () => {
    const { factory, rows } = createFakeIndexedDb(new Map(), { refuseWrites: true })
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    await store.ready

    store.write(EDIT)
    await Promise.resolve()

    expect(store.read()).toEqual(EDIT)
    expect(rows.has('doc-1')).toBe(false)
  })

  it('works with no IndexedDB in the browser at all', async () => {
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory: undefined })

    expect(await store.ready).toBeUndefined()
    store.write(EDIT)
    expect(store.read()).toEqual(EDIT)
    store.clear()
    expect(store.read()).toBeUndefined()
  })

  it('closes the connection when the editing session ends', async () => {
    const { factory, isOpen } = createFakeIndexedDb()
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    await store.ready
    expect(isOpen()).toBe(true)

    store.close()

    expect(isOpen()).toBe(false)
  })

  it('closes a connection that finishes opening after the session has gone', async () => {
    const { factory, isOpen } = createFakeIndexedDb()
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })

    store.close()
    await store.ready

    expect(isOpen()).toBe(false)
  })
})
