/**
 * Test support for the recovery buffer: a fake IndexedDB shared by the
 * store's own tests and by the StrictMode and crash-and-reload tests of the
 * editor that uses it.
 */

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

export interface FakeIndexedDbOptions {
  /** Rejects `open`, as a browser in private mode or out of quota does. */
  readonly refuseToOpen?: boolean
  /** Fails every write, as a quota refusal mid-session does. */
  readonly refuseWrites?: boolean
}

export function createFakeIndexedDb(
  rows: Map<string, unknown> = new Map(),
  options: FakeIndexedDbOptions = {},
): { factory: IDBFactory; rows: Map<string, unknown>; isOpen: () => boolean } {
  /** Every store opens its own connection; this counts the ones not yet closed. */
  let openConnections = 0
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

  const connect = () => {
    let closed = false
    openConnections += 1
    return {
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore: (name: string) => {
        stores.add(name)
        return objectStore
      },
      transaction: () => ({ objectStore: () => objectStore }),
      close: () => {
        if (closed) return
        closed = true
        openConnections -= 1
      },
    }
  }

  const factory = {
    open: () =>
      new FakeRequest<unknown>().settle(
        () => {
          if (options.refuseToOpen === true) throw new Error('Refused')
          return connect()
        },
        () => {
          if (options.refuseToOpen !== true) stores.add('pending-drafts')
        },
      ),
  }

  // The fake implements exactly the slice of `IDBFactory` this module uses;
  // the cast is the boundary of that, and every member it reaches for is
  // above.
  return { factory: factory as unknown as IDBFactory, rows, isOpen: () => openConnections > 0 }
}
