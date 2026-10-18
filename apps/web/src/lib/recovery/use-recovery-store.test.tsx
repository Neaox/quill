import { renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PendingDraft } from '@quill/editor'

import { createFakeIndexedDb } from './testing.ts'
import { useRecoveryStore } from './use-recovery-store.ts'

const EDIT: PendingDraft = {
  ast: { type: 'root', children: [] },
  expectedVersion: 4,
  savedAt: 1_700_000_000_000,
}

function renderStrict(documentId: string) {
  return renderHook(() => useRecoveryStore(documentId), { wrapper: StrictMode })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Audit 2026-10-11, P0-3: StrictMode mounts, cleans up and mounts again. The
 * cleanup closed the store the first mount had opened, the second mount
 * reused that closed store, and every write after that stayed in memory: the
 * recovery buffer never wrote anything in development.
 */
describe('useRecoveryStore under StrictMode', () => {
  it('mirrors an unsent edit to IndexedDB', async () => {
    const { factory, rows } = createFakeIndexedDb()
    vi.stubGlobal('indexedDB', factory)
    const { result } = renderStrict('doc-1')

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })
    if (!result.current.isReady) throw new Error('unreachable')
    result.current.store.write(EDIT)

    await waitFor(() => {
      expect(rows.get('doc-1')).toEqual({ format: 2, pending: EDIT })
    })
  })

  it('hands back what a crashed session left behind', async () => {
    const { factory } = createFakeIndexedDb(new Map([['doc-1', EDIT]]))
    vi.stubGlobal('indexedDB', factory)
    const { result } = renderStrict('doc-1')

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })
    expect(result.current).toMatchObject({ isReady: true, recovered: EDIT })
  })

  it('keeps an edit set aside on reload apart from the one waiting to be sent', async () => {
    const { factory, rows } = createFakeIndexedDb()
    vi.stubGlobal('indexedDB', factory)
    const { result } = renderStrict('doc-1')

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })
    if (!result.current.isReady) throw new Error('unreachable')
    result.current.setAside.write(EDIT)

    await waitFor(() => {
      expect(rows.get('doc-1:set-aside')).toEqual({ format: 2, pending: EDIT })
    })
    expect(rows.has('doc-1')).toBe(false)
  })

  it('closes what it opened when the editor really goes away', async () => {
    const { factory, isOpen } = createFakeIndexedDb()
    vi.stubGlobal('indexedDB', factory)
    const { result, unmount } = renderStrict('doc-1')
    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })
    expect(isOpen()).toBe(true)

    unmount()
    expect(isOpen()).toBe(false)
  })
})
