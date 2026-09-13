import { useEffect, useMemo, useState } from 'react'

import type { PendingDraft } from '@quill/editor'

import {
  createIndexedDbRecoveryStore,
  type PersistentRecoveryStore,
} from './indexeddb-recovery-store.ts'

export interface RecoveryStoreState {
  readonly store: PersistentRecoveryStore
  /**
   * False until the entry a previous session left behind has been read back.
   * `useAutosave` reads the store once, in a lazy initialiser, so mounting it
   * before this is true would silently discard that entry.
   */
  readonly isReady: boolean
  /** What was recovered, so the editor can say that it was. */
  readonly recovered: PendingDraft | undefined
}

/**
 * The document's recovery buffer, opened and closed with the editing session.
 *
 * One store per document, so two documents open in two tabs recover
 * independently, and the connection is closed on the way out rather than left
 * to the garbage collector.
 */
export function useRecoveryStore(documentId: string): RecoveryStoreState {
  const store = useMemo(
    () => createIndexedDbRecoveryStore({ documentId, factory: globalThis.indexedDB }),
    [documentId],
  )
  const [state, setState] = useState<{
    readonly isReady: boolean
    readonly recovered: PendingDraft | undefined
  }>({ isReady: false, recovered: undefined })

  // Synchronises with IndexedDB, an external system whose answer arrives
  // asynchronously: the store is opened, the unsent edit of a previous
  // session is read back, and the connection is closed on the way out.
  useEffect(() => {
    let live = true
    void store.ready.then((recovered) => {
      if (live) setState({ isReady: true, recovered })
    })
    return () => {
      live = false
      store.close()
    }
  }, [store])

  return { store, isReady: state.isReady, recovered: state.recovered }
}
