import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { FakeClock } from './clock.ts'
import { createFakeClock } from './clock.ts'
import type { DocumentAst, DraftClient, DraftSaveNote } from './clients.ts'
import type { RecoveryStore } from './recovery-store.ts'
import { createMemoryRecoveryStore } from './recovery-store.ts'
import { useAutosave } from './use-autosave.ts'

/**
 * The base the recovery store keeps for a three-way merge (ADR-021,
 * amendment of 2026-10-11), and the way a merge is handed back to autosave.
 */

const paragraph = (text: string): DocumentAst => ({
  type: 'root',
  children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
})

interface Save {
  readonly ast: DocumentAst
  readonly expectedVersion: number
  readonly note: DraftSaveNote | undefined
}

function createClient() {
  const saves: Save[] = []
  let version = 1
  let hold: (() => void) | undefined
  const client: DraftClient = {
    load: async () => ({ ast: paragraph(''), draftVersion: version, baseRevision: null }),
    save: async (ast, expectedVersion, note) => {
      saves.push({ ast, expectedVersion, note })
      if (hold !== undefined) await new Promise<void>((resolve) => (hold = resolve))
      version = expectedVersion + 1
      return { status: 'saved', draftVersion: version, updatedAt: version }
    },
  }
  return {
    client,
    saves,
    /** Holds the next answer until `release` is called. */
    holdNext: () => {
      hold = () => {}
    },
    release: () => {
      const resolve = hold
      hold = undefined
      resolve?.()
    },
  }
}

function render(
  client: DraftClient,
  clock: FakeClock,
  store: RecoveryStore = createMemoryRecoveryStore(),
) {
  const view = renderHook(() =>
    useAutosave({
      client,
      store,
      documentVersion: 1,
      documentAst: paragraph('loaded'),
      canSave: true,
      clock,
      debounceMs: 1000,
    }),
  )
  return { ...view, store }
}

async function tick(clock: FakeClock, ms: number): Promise<void> {
  await act(async () => {
    clock.advance(ms)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useAutosave: the merge base', () => {
  it('keeps the draft as loaded as the base, before anything is typed', () => {
    const { store } = render(createClient().client, createFakeClock())
    expect(store.readBase()).toEqual({ ast: paragraph('loaded'), draftVersion: 1 })
  })

  it('keeps the base an unsent edit from a previous session was written on', () => {
    const store = createMemoryRecoveryStore(
      { ast: paragraph('unsent'), expectedVersion: 1, savedAt: 0 },
      { ast: paragraph('older'), draftVersion: 1 },
    )
    render(createClient().client, createFakeClock(), store)
    expect(store.readBase()).toEqual({ ast: paragraph('older'), draftVersion: 1 })
  })

  it('replaces the base with what each acknowledged save sent', async () => {
    const { client } = createClient()
    const clock = createFakeClock()
    const { result, store } = render(client, clock)
    act(() => {
      result.current.change(paragraph('first'))
    })
    await tick(clock, 1000)
    expect(store.readBase()).toEqual({ ast: paragraph('first'), draftVersion: 2 })
  })
})

describe('useAutosave: adopting a merge', () => {
  it('saves the merged tree on top of the server’s version, saying it is a merge', async () => {
    const fake = createClient()
    const clock = createFakeClock()
    const { result, store } = render(fake.client, clock)

    act(() => {
      result.current.adopt(
        paragraph('merged'),
        { ast: paragraph('theirs'), draftVersion: 7 },
        { merged: true },
      )
    })
    expect(store.readBase()).toEqual({ ast: paragraph('theirs'), draftVersion: 7 })
    expect(result.current.status).toBe('dirty')
    expect(result.current.draftVersion).toBe(7)

    await tick(clock, 1000)
    expect(fake.saves).toEqual([
      { ast: paragraph('merged'), expectedVersion: 7, note: { merged: true } },
    ])
    expect(store.readBase()).toEqual({ ast: paragraph('merged'), draftVersion: 8 })
  })

  it('sends edits typed before the merge was acknowledged as part of it, and later ones plainly', async () => {
    const fake = createClient()
    const clock = createFakeClock()
    const { result } = render(fake.client, clock)

    act(() => {
      result.current.adopt(
        paragraph('merged'),
        { ast: paragraph('theirs'), draftVersion: 7 },
        { merged: true },
      )
      result.current.change(paragraph('merged, then more'))
    })
    await tick(clock, 1000)
    expect(fake.saves.at(-1)).toMatchObject({ note: { merged: true } })

    fake.holdNext()
    act(() => {
      result.current.change(paragraph('ordinary'))
    })
    await tick(clock, 1000)
    act(() => {
      result.current.change(() => paragraph('typed while saving'))
    })
    await act(async () => {
      fake.release()
      await Promise.resolve()
    })
    await tick(clock, 1000)
    expect(fake.saves.map(({ note }) => note)).toEqual([{ merged: true }, undefined, undefined])
  })

  it('keeps an edit of its own over the server’s draft without calling it a merge', async () => {
    const fake = createClient()
    const clock = createFakeClock()
    const { result } = render(fake.client, clock)
    act(() => {
      result.current.adopt(paragraph('mine'), { ast: paragraph('theirs'), draftVersion: 7 })
    })
    await tick(clock, 1000)
    expect(fake.saves).toEqual([{ ast: paragraph('mine'), expectedVersion: 7, note: undefined }])
  })

  it('carries on from the server’s draft with nothing to send', () => {
    const { result, store } = render(createClient().client, createFakeClock())
    act(() => {
      result.current.change(() => paragraph('typed into the old tree'))
      result.current.adopt(undefined, { ast: paragraph('theirs'), draftVersion: 7 })
    })
    expect(result.current.status).toBe('idle')
    expect(store.read()).toBeUndefined()
    expect(result.current.unsaved).toBe(false)
  })
})
