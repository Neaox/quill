import { useEffect, useState } from 'react'

import type { PendingDraft } from '@quill/editor'

import {
  createIndexedDbRecoveryStore,
  type PersistentRecoveryStore,
} from './indexeddb-recovery-store.ts'

/**
 * `useAutosave` reads the store once, in a lazy initialiser, so the editor
 * mounts only once the entry a previous session left behind has been read
 * back: until then there is no store to hand it.
 */
export type RecoveryStoreState =
  | { readonly isReady: false }
  | {
      readonly isReady: true
      /** The unsent edit autosave is working on. */
      readonly store: PersistentRecoveryStore
      /**
       * An unsent edit the author set aside to reload a draft that changed
       * elsewhere (audit 2026-10-11, P0-5). It is kept, and offered back,
       * rather than sent: it was written against a version that is gone.
       */
      readonly setAside: PersistentRecoveryStore
      /** What a previous session left unsent, so the editor can say that it was. */
      readonly recovered: PendingDraft | undefined
    }

/**
 * The document's recovery buffers, opened and closed with the editing session.
 *
 * One store per document, so two documents open in two tabs recover
 * independently, and the connection is closed on the way out rather than left
 * to the garbage collector.
 *
 * The stores are created *inside* the effect that closes them and handed out
 * through state, never through `useMemo` (audit 2026-10-11, P0-3). StrictMode
 * mounts, cleans up and mounts again; a memoised store was closed by the
 * first cleanup and then reused, closed, by the second mount, so nothing was
 * ever written in development. Here the first pair is opened and closed, the
 * second pair is opened, and only the live one ever reaches the editor — which
 * also holds for any real remount later (`<Activity>`, a route key).
 */
export function useRecoveryStore(documentId: string): RecoveryStoreState {
  // Tagged with the document it was opened for, so moving to another
  // document is "not ready" at once rather than a closed store for a moment.
  const [opened, setOpened] = useState<{
    readonly documentId: string
    readonly state: RecoveryStoreState
  }>()

  // Synchronises with IndexedDB, an external system whose answer arrives
  // asynchronously: the stores are opened, the unsent edit of a previous
  // session is read back, and the connections are closed on the way out.
  useEffect(() => {
    const open = (key: string) =>
      createIndexedDbRecoveryStore({ documentId: key, factory: globalThis.indexedDB })
    const store = open(documentId)
    const setAside = open(`${documentId}:set-aside`)
    let live = true
    void Promise.all([store.ready, setAside.ready]).then(([recovered]) => {
      if (live) setOpened({ documentId, state: { isReady: true, store, setAside, recovered } })
    })
    return () => {
      live = false
      store.close()
      setAside.close()
    }
  }, [documentId])

  return opened?.documentId === documentId ? opened.state : NOT_READY
}

const NOT_READY: RecoveryStoreState = { isReady: false }
