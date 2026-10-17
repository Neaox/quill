import { describe, expect, it, vi } from 'vitest'

import type { PendingDraft } from '@quill/editor'

import { createIndexedDbRecoveryStore } from './indexeddb-recovery-store.ts'
import { createFakeIndexedDb } from './testing.ts'

const EDIT: PendingDraft = {
  ast: { type: 'root', children: [] },
  expectedVersion: 4,
  savedAt: 1_700_000_000_000,
}

const BASE = { ast: { type: 'root' as const, children: [] }, draftVersion: 3 }

describe('createIndexedDbRecoveryStore: the edit and its base (row format 2)', () => {
  it('reads a row an earlier release wrote, as an edit with no base', async () => {
    const { factory } = createFakeIndexedDb(new Map([['doc-1', EDIT]]))
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    expect(await store.ready).toEqual(EDIT)
    expect(store.readBase()).toBeUndefined()
  })

  it('reads back an edit and the base it was written on', async () => {
    const { factory } = createFakeIndexedDb(
      new Map([['doc-1', { format: 2, pending: EDIT, base: BASE }]]),
    )
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    expect(await store.ready).toEqual(EDIT)
    expect(store.readBase()).toEqual(BASE)
  })

  it('keeps the base when the edit is acknowledged, and both in one row', async () => {
    const { factory, rows } = createFakeIndexedDb()
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    await store.ready
    store.writeBase(BASE)
    store.write(EDIT)
    await vi.waitFor(() => {
      expect(rows.get('doc-1')).toEqual({ format: 2, pending: EDIT, base: BASE })
    })
    store.clear()
    await vi.waitFor(() => {
      expect(rows.get('doc-1')).toEqual({ format: 2, base: BASE })
    })
  })

  it('reads nothing from a row of a format it does not know, rather than guess', async () => {
    const { factory } = createFakeIndexedDb(new Map([['doc-1', { format: 9, pending: EDIT }]]))
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    expect(await store.ready).toBeUndefined()
    expect(store.readBase()).toBeUndefined()
  })

  it('ignores the parts of a row that are not what they claim', async () => {
    const { factory } = createFakeIndexedDb(
      new Map([
        ['doc-1', { format: 2, pending: { ast: null }, base: { draftVersion: 1, ast: null } }],
      ]),
    )
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    expect(await store.ready).toBeUndefined()
    expect(store.readBase()).toBeUndefined()
  })

  it('keeps a base written while the database was opening over the one on disk', async () => {
    const { factory } = createFakeIndexedDb(new Map([['doc-1', { format: 2, base: BASE }]]))
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    const newer = { ...BASE, draftVersion: 9 }
    store.writeBase(newer)
    await store.ready
    expect(store.readBase()).toEqual(newer)
  })
})

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
      expect(rows.get('doc-1')).toEqual({ format: 2, pending: EDIT })
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
