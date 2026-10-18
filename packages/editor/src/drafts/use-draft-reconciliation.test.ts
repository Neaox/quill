import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { parseMarkdown, stringifyMdast } from '@quill/markdown'

import type { AutosaveStatus } from './autosave-machine.ts'
import { createFakeClock } from './clock.ts'
import type { FakeClock } from './clock.ts'
import type { DocumentAst, DraftClient, LoadedDraft } from './clients.ts'
import type { LockStatus } from './lock-machine.ts'
import { initialLockState } from './lock-machine.ts'
import type { RecoveryStore } from './recovery-store.ts'
import { createMemoryRecoveryStore } from './recovery-store.ts'
import type { Autosave } from './use-autosave.ts'
import type { DocumentLock } from './use-document-lock.ts'
import type { MergeRunner } from './use-draft-reconciliation.ts'
import {
  mergeOnThisThread,
  RECONCILE_RETRY_MS,
  useDraftReconciliation,
} from './use-draft-reconciliation.ts'

/** The edges of the hook the end-to-end scenarios (`offline-merge.test.ts`) do not reach. */

const md = (markdown: string): DocumentAst => parseMarkdown(markdown)
const BASE = 'One.\n\nTwo.\n'

function fakeLock(status: LockStatus): DocumentLock {
  return {
    ...initialLockState,
    status,
    acquire: vi.fn<() => Promise<void>>(async () => {}),
    reacquire: vi.fn<() => Promise<void>>(async () => {}),
    takeover: vi.fn<() => Promise<void>>(async () => {}),
    release: vi.fn<() => Promise<void>>(async () => {}),
  }
}

function fakeAutosave(status: AutosaveStatus, store: RecoveryStore, typed?: () => void): Autosave {
  return {
    status,
    phase: { status: 'idle' },
    draftVersion: 1,
    lastSavedAt: null,
    pending: store.read(),
    unsaved: store.read() !== undefined,
    holder: null,
    change: vi.fn<Autosave['change']>(),
    flush: vi.fn<() => Promise<void>>(async () => {}),
    retry: vi.fn<() => void>(),
    keepMine: vi.fn<() => Promise<void>>(async () => {}),
    buffer: vi.fn<() => void>(() => typed?.()),
    adopt: vi.fn<Autosave['adopt']>(),
  }
}

function serverAt(markdown: string, version = 5) {
  const theirs: LoadedDraft = { ast: md(markdown), draftVersion: version, baseRevision: null }
  return {
    load: vi.fn<DraftClient['load']>(async () => theirs),
    save: vi.fn<DraftClient['save']>(),
  }
}

async function settle(clock: FakeClock, ms = 0): Promise<void> {
  await act(async () => {
    clock.advance(ms)
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
  })
}

function render(options: {
  lock?: DocumentLock
  autosave: Autosave
  client: DraftClient
  store: RecoveryStore
  merge?: MergeRunner
  clock?: FakeClock
}) {
  const clock = options.clock ?? createFakeClock()
  const onReplace = vi.fn<(ast: DocumentAst) => void>()
  const onMerged = vi.fn<(theirs: LoadedDraft) => void>()
  const view = renderHook(() =>
    useDraftReconciliation({
      lock: options.lock ?? fakeLock('held'),
      autosave: options.autosave,
      client: options.client,
      store: options.store,
      clock,
      onReplace,
      onMerged,
      ...(options.merge === undefined ? {} : { merge: options.merge }),
    }),
  )
  return { ...view, clock, onReplace, onMerged }
}

describe('useDraftReconciliation', () => {
  it('carries on from the server’s draft when nothing of ours is waiting', async () => {
    const store = createMemoryRecoveryStore()
    const client = serverAt('Theirs.\n')
    const autosave = fakeAutosave('conflict', store)
    const { onReplace, clock } = render({ autosave, client, store })
    await settle(clock)
    expect(onReplace).toHaveBeenCalledWith(md('Theirs.\n'))
    expect(autosave.adopt).toHaveBeenCalledWith(
      undefined,
      { ast: md('Theirs.\n'), draftVersion: 5 },
      undefined,
    )
  })

  it('merges a recovered edit with no base against an empty one, keeping both sides', async () => {
    const store = createMemoryRecoveryStore({ ast: md('Mine.\n'), expectedVersion: 1, savedAt: 0 })
    const client = serverAt('Theirs.\n')
    const { result, clock } = render({ autosave: fakeAutosave('conflict', store), client, store })
    await settle(clock)
    expect(result.current.phase.status).toBe('conflicted')
  })

  it('merges again with what was typed while the merge ran', async () => {
    const store = createMemoryRecoveryStore(
      { ast: md('One, mine.\n\nTwo.\n'), expectedVersion: 1, savedAt: 0 },
      { ast: md(BASE), draftVersion: 1 },
    )
    const client = serverAt('One.\n\nTwo, theirs.\n')
    let typedOnce = false
    const autosave = fakeAutosave('conflict', store, () => {
      // The second read finds a newer edit, typed meanwhile.
      if (vi.mocked(client.load).mock.calls.length === 1 && !typedOnce) {
        typedOnce = true
        store.write({ ast: md('One, mine, more.\n\nTwo.\n'), expectedVersion: 1, savedAt: 1 })
      }
    })
    const { onReplace, onMerged, clock } = render({ autosave, client, store })
    await settle(clock)
    expect(client.load).toHaveBeenCalledTimes(2)
    expect(stringifyMdast(onReplace.mock.calls[0]?.[0] ?? md(''))).toBe(
      'One, mine, more.\n\nTwo, theirs.\n',
    )
    expect(onMerged).toHaveBeenCalledTimes(1)
  })

  it('tries again when the server’s draft could not be read', async () => {
    const store = createMemoryRecoveryStore(
      { ast: md('One, mine.\n\nTwo.\n'), expectedVersion: 1, savedAt: 0 },
      { ast: md(BASE), draftVersion: 1 },
    )
    const client = serverAt('One.\n\nTwo, theirs.\n')
    client.load.mockRejectedValueOnce(new Error('Failed to fetch')).mockRejectedValueOnce('down')
    const { result, clock, onMerged } = render({
      autosave: fakeAutosave('conflict', store),
      client,
      store,
    })
    await settle(clock)
    expect(result.current.phase).toEqual({ status: 'failed', reason: 'Failed to fetch' })
    await settle(clock, RECONCILE_RETRY_MS)
    expect(result.current.phase).toEqual({
      status: 'failed',
      reason: 'The draft could not be read',
    })
    await settle(clock, RECONCILE_RETRY_MS)
    expect(onMerged).toHaveBeenCalledTimes(1)
    expect(result.current.phase.status).toBe('idle')
  })

  it('runs the merge it is given, which may be a worker', async () => {
    const store = createMemoryRecoveryStore(
      { ast: md('One, mine.\n\nTwo.\n'), expectedVersion: 1, savedAt: 0 },
      { ast: md(BASE), draftVersion: 1 },
    )
    const merge = vi.fn<MergeRunner>(mergeOnThisThread)
    const { clock } = render({
      autosave: fakeAutosave('conflict', store),
      client: serverAt('One.\n\nTwo!\n'),
      store,
      merge,
    })
    await settle(clock)
    expect(merge).toHaveBeenCalledTimes(1)
  })

  it('ignores resolutions when there is no conflict, and incomplete ones when there is', async () => {
    const store = createMemoryRecoveryStore(
      { ast: md('One, mine.\n\nTwo.\n'), expectedVersion: 1, savedAt: 0 },
      { ast: md(BASE), draftVersion: 1 },
    )
    const autosave = fakeAutosave('conflict', store)
    const { result, clock } = render({
      autosave,
      client: serverAt('One, theirs.\n\nTwo.\n'),
      store,
    })
    act(() => {
      result.current.resolve([])
      result.current.keepMine()
    })
    expect(autosave.adopt).not.toHaveBeenCalled()
    await settle(clock)
    expect(result.current.phase.status).toBe('conflicted')
    act(() => {
      result.current.resolve([])
    })
    expect(autosave.adopt).not.toHaveBeenCalled()
    expect(result.current.phase.status).toBe('conflicted')
  })

  it('takes a lapsed lock again once per stretch without a save, then leaves it to the author', async () => {
    const store = createMemoryRecoveryStore({ ast: md('Mine.\n'), expectedVersion: 1, savedAt: 0 })
    const lock = fakeLock('lost')
    const autosave = fakeAutosave('blocked', store)
    const { rerender, clock } = render({ lock, autosave, client: serverAt(BASE), store })
    await settle(clock)
    expect(lock.acquire).toHaveBeenCalledTimes(1)
    expect(autosave.retry).toHaveBeenCalledTimes(1)
    rerender()
    await settle(clock, 30_000)
    expect(lock.acquire).toHaveBeenCalledTimes(1)
  })

  it('saves ours as it is when the server holds the very draft ours was based on', async () => {
    const store = createMemoryRecoveryStore(
      { ast: md('One, mine.\n\nTwo.\n'), expectedVersion: 1, savedAt: 0 },
      { ast: md(BASE), draftVersion: 1 },
    )
    const autosave = fakeAutosave('conflict', store)
    const { clock, onReplace } = render({ autosave, client: serverAt(BASE, 2), store })
    await settle(clock)
    expect(onReplace).not.toHaveBeenCalled()
    expect(autosave.adopt).toHaveBeenCalledWith(
      md('One, mine.\n\nTwo.\n'),
      { ast: md(BASE), draftVersion: 2 },
      undefined,
    )
  })

  it('asks for a lock somebody else holds until the session ends, and then stops', async () => {
    const store = createMemoryRecoveryStore({ ast: md('Mine.\n'), expectedVersion: 1, savedAt: 0 })
    const lock = fakeLock('held_by_other')
    const autosave = fakeAutosave('blocked', store)
    const { result, unmount, clock } = render({ lock, autosave, client: serverAt(BASE), store })
    expect(result.current.phase).toEqual({ status: 'waiting', holder: null })
    await settle(clock, 15_000)
    expect(lock.reacquire).toHaveBeenCalledTimes(1)
    act(() => {
      clock.advance(15_000)
      unmount()
    })
    await settle(clock, 30_000)
    expect(lock.reacquire).toHaveBeenCalledTimes(2)
    expect(clock.pending).toBe(0)
  })

  it('keeps time by the system clock unless given another', () => {
    const store = createMemoryRecoveryStore()
    const { result } = renderHook(() =>
      useDraftReconciliation({
        lock: fakeLock('held'),
        autosave: fakeAutosave('saved', store),
        client: serverAt(BASE),
        store,
        onReplace: () => {},
        onMerged: () => {},
      }),
    )
    expect(result.current.phase.status).toBe('idle')
  })
})
