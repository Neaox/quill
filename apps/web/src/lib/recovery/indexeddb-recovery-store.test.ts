import { describe, expect, it, vi } from 'vitest'

import type { DraftBase, PendingDraft } from '@quill/editor'

import { createIndexedDbRecoveryStore } from './indexeddb-recovery-store.ts'
import { createFakeIndexedDb } from './testing.ts'

const EDIT: PendingDraft = {
  ast: { type: 'root', children: [] },
  expectedVersion: 4,
  savedAt: 1_700_000_000_000,
}

const BASE: DraftBase = { ast: { type: 'root', children: [] }, draftVersion: 3 }

describe('the recovery store’s base', () => {
  it('has none for a document nobody has saved', async () => {
    const { factory } = createFakeIndexedDb()
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    await store.ready
    expect(store.readBase()).toBeUndefined()
  })

  it('remembers the draft the editor last agreed with the server, and mirrors it', async () => {
    const { factory, rows } = createFakeIndexedDb()
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })
    await store.ready

    store.writeBase(BASE)

    expect(store.readBase()).toEqual(BASE)
    await vi.waitFor(() => {
      expect(rows.get('doc-1#base')).toEqual(BASE)
    })
    // Beside the edit and not instead of it.
    expect(rows.has('doc-1')).toBe(false)
  })

  it('hands back the base a previous session left, with the edit it was left beside', async () => {
    const { factory } = createFakeIndexedDb(
      new Map<string, unknown>([
        ['doc-1', EDIT],
        ['doc-1#base', BASE],
      ]),
    )
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory })

    expect(await store.ready).toEqual(EDIT)
    expect(store.readBase()).toEqual(BASE)
  })

  it('ignores a base that is not one, and never lets a recovered one replace a newer', async () => {
    const stale = createFakeIndexedDb(
      new Map<string, unknown>([['doc-1#base', { nonsense: true }]]),
    )
    const junk = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory: stale.factory })
    await junk.ready
    expect(junk.readBase()).toBeUndefined()

    const old = createFakeIndexedDb(
      new Map<string, unknown>([['doc-1#base', { ...BASE, draftVersion: 1 }]]),
    )
    const store = createIndexedDbRecoveryStore({ documentId: 'doc-1', factory: old.factory })
    store.writeBase(BASE)
    await store.ready
    expect(store.readBase()).toEqual(BASE)
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
