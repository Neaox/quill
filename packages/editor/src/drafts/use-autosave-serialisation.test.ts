import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { FakeClock } from './clock.ts'
import { createFakeClock } from './clock.ts'
import type { DocumentAst, DraftClient, DraftSaveResult } from './clients.ts'
import { createFakeConnectivity } from './connectivity.ts'
import type { FakeConnectivity } from './connectivity.ts'
import { createMemoryRecoveryStore } from './recovery-store.ts'
import { useAutosave } from './use-autosave.ts'

/**
 * When the tree is read (P0-6 in docs/research/2026-10-11-editor-vs-confluence.md).
 *
 * Serialising a long document costs several frames, so a keystroke hands
 * autosave a way to read the tree rather than the tree: it is read once,
 * when a save is about to be sent or the edit has to be buffered, and never
 * per keystroke.
 */

const paragraph = (text: string): DocumentAst => ({
  type: 'root',
  children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
})

/** The editor's side: a tree that changes as the author types, and a count of reads. */
function createDocument() {
  let text = ''
  let reads = 0
  return {
    type(more: string) {
      text += more
    },
    read: (): DocumentAst => {
      reads += 1
      return paragraph(text)
    },
    get reads() {
      return reads
    },
  }
}

function createClient() {
  const saves: { readonly ast: DocumentAst; readonly expectedVersion: number }[] = []
  let version = 1
  let hold: Promise<void> | undefined
  const client: DraftClient = {
    load: async () => ({ ast: paragraph(''), draftVersion: version, baseRevision: null }),
    save: async (ast, expectedVersion): Promise<DraftSaveResult> => {
      saves.push({ ast, expectedVersion })
      await hold
      version += 1
      return { status: 'saved', draftVersion: version, updatedAt: version }
    },
  }
  return {
    client,
    saves,
    /** Keeps the next answers back until the returned function is called. */
    holdAnswers(): () => void {
      const { promise, resolve } = Promise.withResolvers<void>()
      hold = promise
      return () => {
        hold = undefined
        resolve()
      }
    },
  }
}

function setup(options: { canSave?: boolean; connectivity?: FakeConnectivity } = {}) {
  const clock = createFakeClock(10_000)
  const store = createMemoryRecoveryStore()
  const server = createClient()
  const doc = createDocument()
  let renders = 0
  const view = renderHook(
    ({ canSave }: { canSave: boolean }) => {
      renders += 1
      return useAutosave({
        client: server.client,
        store,
        documentVersion: 1,
        canSave,
        clock,
        debounceMs: 1000,
        connectivity: options.connectivity ?? createFakeConnectivity(),
      })
    },
    { initialProps: { canSave: options.canSave ?? true } },
  )
  /** One keystroke, as the editor reports it: a change, and a way to read the tree. */
  const keystroke = (text: string) => {
    doc.type(text)
    act(() => {
      view.result.current.change(doc.read)
    })
  }
  return {
    ...view,
    clock,
    store,
    server,
    doc,
    keystroke,
    get renders() {
      return renders
    },
  }
}

async function tick(clock: FakeClock, ms: number): Promise<void> {
  await act(async () => {
    clock.advance(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useAutosave reading the tree', () => {
  it('reads nothing while the author types, and marks the draft unsaved at once', () => {
    const session = setup()
    for (const letter of 'typing') {
      session.keystroke(letter)
      act(() => {
        session.clock.advance(200)
      })
    }
    expect(session.doc.reads).toBe(0)
    expect(session.server.saves).toEqual([])
    expect(session.result.current.status).toBe('dirty')
    expect(session.result.current.unsaved).toBe(true)
  })

  it('reads the tree once, when the debounce after the last keystroke sends it', async () => {
    const session = setup()
    session.keystroke('a')
    await tick(session.clock, 600)
    session.keystroke('b')
    await tick(session.clock, 999)
    expect(session.server.saves).toEqual([])

    await tick(session.clock, 1)
    expect(session.doc.reads).toBe(1)
    expect(session.server.saves).toEqual([{ ast: paragraph('ab'), expectedVersion: 1 }])
    expect(session.result.current.status).toBe('saved')
    expect(session.result.current.unsaved).toBe(false)
    expect(session.store.read()).toBeUndefined()
  })

  it('renders the session once for a burst of keystrokes, not once per keystroke', () => {
    const session = setup()
    session.keystroke('a')
    const afterFirst = session.renders
    for (const letter of ' further forty letters of typing') session.keystroke(letter)
    expect(session.renders).toBe(afterFirst)
  })

  it('reads the tree when flushed, ignoring the debounce', async () => {
    const session = setup()
    session.keystroke('now')
    await act(() => session.result.current.flush())
    expect(session.doc.reads).toBe(1)
    expect(session.server.saves).toEqual([{ ast: paragraph('now'), expectedVersion: 1 }])
  })

  it('sends an edit made while a save is out next, on the version that save made', async () => {
    const session = setup()
    session.keystroke('first')
    const release = session.server.holdAnswers()
    await tick(session.clock, 1000)
    session.keystroke(' second')
    expect(session.result.current.unsaved).toBe(true)
    await act(async () => {
      release()
      await Promise.resolve()
    })
    expect(session.result.current.status).toBe('dirty')
    // The edit sent was acknowledged, so it is not kept as if it were unsent.
    expect(session.store.read()).toBeUndefined()

    await tick(session.clock, 1000)
    expect(session.server.saves).toEqual([
      { ast: paragraph('first'), expectedVersion: 1 },
      { ast: paragraph('first second'), expectedVersion: 2 },
    ])
  })

  it('buffers the edit in this browser without sending while it cannot save', async () => {
    const session = setup({ canSave: false })
    session.keystroke('held')
    await tick(session.clock, 1000)
    expect(session.store.read()?.ast).toEqual(paragraph('held'))
    expect(session.server.saves).toEqual([])
    expect(session.clock.pending).toBe(0)
  })

  it('buffers an edit typed while a save is out, once typing pauses', async () => {
    const session = setup()
    session.keystroke('first')
    const release = session.server.holdAnswers()
    await tick(session.clock, 1000)
    session.keystroke(' second')
    await tick(session.clock, 1000)
    // Still in flight: nothing can be sent, but a crash now must not lose it.
    expect(session.store.read()?.ast).toEqual(paragraph('first second'))
    expect(session.server.saves).toHaveLength(1)
    release()
  })

  it('buffers the edit as soon as the tab is hidden', () => {
    const connectivity = createFakeConnectivity()
    const session = setup({ connectivity })
    session.keystroke('leaving')
    act(() => {
      connectivity.setVisible(false)
    })
    expect(session.store.read()?.ast).toEqual(paragraph('leaving'))
    expect(session.server.saves).toEqual([])
  })

  it('buffers an edit still waiting when the session ends', () => {
    const session = setup()
    session.keystroke('closing')
    session.unmount()
    expect(session.store.read()?.ast).toEqual(paragraph('closing'))
  })

  it('still takes a tree, buffered at once, from a caller that has one', () => {
    const session = setup()
    act(() => {
      session.result.current.change(paragraph('whole'))
    })
    expect(session.store.read()?.ast).toEqual(paragraph('whole'))
    expect(session.result.current.unsaved).toBe(true)
  })
})
