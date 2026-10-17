import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FakeClock } from './clock.ts'
import { createFakeClock } from './clock.ts'
import type {
  DocumentAst,
  DraftClient,
  DraftSaveResult,
  HeartbeatResult,
  Lock,
  LockClient,
  LockHolder,
  LoadedDraft,
} from './clients.ts'
import type { RecoveryStore } from './recovery-store.ts'
import { createFakeConnectivity } from './connectivity.ts'
import { createMemoryDraftChannels } from './draft-channel.ts'
import { createMemoryRecoveryStore } from './recovery-store.ts'
import type { UseAutosaveOptions } from './use-autosave.ts'
import { useAutosave } from './use-autosave.ts'
import { useDocumentLock } from './use-document-lock.ts'

const holder: LockHolder = { userId: 'u2', displayName: 'Priya', expiresAt: 120_000 }
const lock: Lock = { holderUserId: 'u1', holderSessionId: 's1', expiresAt: 60_000 }

const paragraph = (text: string): DocumentAst => ({
  type: 'root',
  children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
})

interface SaveCall {
  readonly ast: DocumentAst
  readonly expectedVersion: number
}

interface FakeDraftClient {
  readonly client: DraftClient
  readonly saves: SaveCall[]
  answer(result: DraftSaveResult): void
}

function createFakeDraftClient(): FakeDraftClient {
  const saves: SaveCall[] = []
  let version = 1
  let next: DraftSaveResult | undefined

  const loaded: LoadedDraft = { ast: paragraph(''), draftVersion: 1, baseRevision: null }

  return {
    saves,
    client: {
      load: async () => loaded,
      save: async (ast, expectedVersion) => {
        saves.push({ ast, expectedVersion })
        if (next !== undefined) return next
        version += 1
        return { status: 'saved', draftVersion: version, updatedAt: version * 1000 }
      },
    },
    answer: (result) => {
      next = result
    },
  }
}

interface Options {
  readonly canSave?: boolean
  readonly documentVersion?: number
  readonly store?: RecoveryStore
}

function render(fake: FakeDraftClient, clock: FakeClock, options: Options = {}) {
  const store = options.store ?? createMemoryRecoveryStore()
  const view = renderHook(
    (props: { canSave: boolean; documentVersion: number }) =>
      useAutosave({
        client: fake.client,
        store,
        documentVersion: props.documentVersion,
        canSave: props.canSave,
        clock,
        debounceMs: 1000,
      }),
    {
      initialProps: {
        canSave: options.canSave ?? true,
        documentVersion: options.documentVersion ?? 1,
      },
    },
  )
  return { ...view, store }
}

/** Moves time forward and lets the resulting request settle. */
async function tick(clock: FakeClock, ms: number): Promise<void> {
  await act(async () => {
    clock.advance(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useAutosave', () => {
  it('starts idle with nothing buffered', () => {
    const { result } = render(createFakeDraftClient(), createFakeClock())
    expect(result.current.status).toBe('idle')
    expect(result.current.pending).toBeUndefined()
    expect(result.current.lastSavedAt).toBeNull()
    expect(result.current.holder).toBeNull()
  })

  it('buffers the edit before any network call', () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock(5_000)
    const { result, store } = render(fake, clock)

    act(() => {
      result.current.change(paragraph('hello'))
    })

    expect(store.read()).toEqual({
      ast: paragraph('hello'),
      expectedVersion: 1,
      savedAt: 5_000,
    })
    expect(fake.saves).toHaveLength(0)
    expect(result.current.status).toBe('dirty')
  })

  it('collapses a burst of edits into one save carrying the latest tree', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)

    act(() => {
      result.current.change(paragraph('a'))
    })
    await tick(clock, 900)
    act(() => {
      result.current.change(paragraph('ab'))
    })
    await tick(clock, 900)
    act(() => {
      result.current.change(paragraph('abc'))
    })
    expect(fake.saves).toHaveLength(0)

    await tick(clock, 1000)

    expect(fake.saves).toEqual([{ ast: paragraph('abc'), expectedVersion: 1 }])
  })

  it('forgets the buffered entry only once the server acknowledges it', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result, store } = render(fake, clock)

    act(() => {
      result.current.change(paragraph('hello'))
    })
    await tick(clock, 1000)

    expect(result.current.status).toBe('saved')
    expect(result.current.draftVersion).toBe(2)
    expect(result.current.lastSavedAt).toBe(2000)
    expect(store.read()).toBeUndefined()
    expect(result.current.pending).toBeUndefined()
  })

  it('bases the next save on the acknowledged version', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)

    act(() => {
      result.current.change(paragraph('one'))
    })
    await tick(clock, 1000)
    act(() => {
      result.current.change(paragraph('two'))
    })
    await tick(clock, 1000)

    expect(fake.saves.map((call) => call.expectedVersion)).toEqual([1, 2])
  })

  it('picks up an entry left behind by a previous session', () => {
    const store = createMemoryRecoveryStore({
      ast: paragraph('crashed'),
      expectedVersion: 1,
      savedAt: 1,
    })
    const { result } = render(createFakeDraftClient(), createFakeClock(), { store })

    expect(result.current.status).toBe('dirty')
    expect(result.current.pending?.ast).toEqual(paragraph('crashed'))
  })

  it('keeps an edit made while a save is in flight', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result, store } = render(fake, clock)

    act(() => {
      result.current.change(paragraph('first'))
    })
    act(() => {
      clock.advance(1000)
    })
    // The request is out; the next keystroke lands before the response does.
    act(() => {
      result.current.change(paragraph('second'))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.status).toBe('dirty')
    expect(store.read()?.ast).toEqual(paragraph('second'))

    await tick(clock, 1000)
    expect(fake.saves.map((call) => call.ast)).toEqual([paragraph('first'), paragraph('second')])
    expect(store.read()).toBeUndefined()
  })
})

describe('useAutosave conflicts', () => {
  it('stops on a conflict, and saves over it only when the author keeps theirs', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result, store, rerender } = render(fake, clock)

    fake.answer({ status: 'stale_version', currentVersion: 7 })
    act(() => {
      result.current.change(paragraph('mine'))
    })
    await tick(clock, 1000)

    expect(result.current.status).toBe('conflict')
    expect(result.current.phase).toEqual({ status: 'conflict', currentVersion: 7 })
    expect(store.read()?.ast).toEqual(paragraph('mine'))

    // No silent retry against a version we already know is wrong, and a newer
    // version arriving as a prop (a background refetch) does not quietly
    // become the base either: that was the silent overwrite of P0-5.
    rerender({ canSave: true, documentVersion: 7 })
    act(() => {
      result.current.change(paragraph('mine again'))
    })
    await tick(clock, 10_000)
    await act(async () => {
      await result.current.flush()
    })
    expect(fake.saves).toHaveLength(1)

    fake.answer({ status: 'saved', draftVersion: 8, updatedAt: 8000 })
    await act(async () => {
      await result.current.keepMine()
    })
    await tick(clock, 1000)

    expect(fake.saves[1]).toEqual({ ast: paragraph('mine again'), expectedVersion: 7 })
    expect(result.current.status).toBe('saved')
    expect(result.current.draftVersion).toBe(8)
  })

  it('blocks and keeps the buffer when the lock is gone', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result, store } = render(fake, clock)

    fake.answer({ status: 'lock_lost', holder })
    act(() => {
      result.current.change(paragraph('mine'))
    })
    await tick(clock, 1000)

    expect(result.current.status).toBe('blocked')
    expect(result.current.holder).toEqual(holder)
    expect(store.read()?.ast).toEqual(paragraph('mine'))

    await tick(clock, 60_000)
    expect(fake.saves).toHaveLength(1)
  })

  it('reports an unknown holder when the lock simply expired', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)

    fake.answer({ status: 'lock_lost', holder: null })
    act(() => {
      result.current.change(paragraph('mine'))
    })
    await tick(clock, 1000)

    expect(result.current.status).toBe('blocked')
    expect(result.current.holder).toBeNull()
  })

  it('signs out without touching the buffer', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result, store } = render(fake, clock)

    fake.answer({ status: 'session_expired' })
    act(() => {
      result.current.change(paragraph('mine'))
    })
    const buffered = store.read()
    await tick(clock, 1000)

    expect(result.current.status).toBe('signed_out')
    expect(store.read()).toBe(buffered)
  })
})

describe('useAutosave while the lock is not ours to use', () => {
  it('buffers edits without sending them, then sends once confidence returns', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result, store, rerender } = render(fake, clock, { canSave: false })

    act(() => {
      result.current.change(paragraph('offline'))
    })
    await tick(clock, 10_000)

    expect(fake.saves).toHaveLength(0)
    expect(store.read()?.ast).toEqual(paragraph('offline'))
    expect(result.current.status).toBe('dirty')

    rerender({ canSave: true, documentVersion: 1 })
    await tick(clock, 1000)

    expect(fake.saves).toEqual([{ ast: paragraph('offline'), expectedVersion: 1 }])
    expect(result.current.status).toBe('saved')
  })

  it('refuses an explicit flush while autosave is not permitted', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock, { canSave: false })

    act(() => {
      result.current.change(paragraph('offline'))
    })
    await act(async () => {
      await result.current.flush()
    })

    expect(fake.saves).toHaveLength(0)
    expect(result.current.status).toBe('dirty')
  })
})

describe('useAutosave flush', () => {
  it('saves at once, without waiting for the debounce', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)

    act(() => {
      result.current.change(paragraph('leaving'))
    })
    await act(async () => {
      await result.current.flush()
    })

    expect(fake.saves).toHaveLength(1)
    expect(result.current.status).toBe('saved')
  })

  it('recovers a blocked document once the lock is back', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result, store } = render(fake, clock)

    fake.answer({ status: 'lock_lost', holder })
    act(() => {
      result.current.change(paragraph('kept'))
    })
    await tick(clock, 1000)
    expect(result.current.status).toBe('blocked')

    fake.answer({ status: 'saved', draftVersion: 9, updatedAt: 9000 })
    await act(async () => {
      await result.current.flush()
    })

    expect(result.current.status).toBe('saved')
    expect(store.read()).toBeUndefined()
  })

  it('does nothing when there is nothing buffered', async () => {
    const fake = createFakeDraftClient()
    const { result } = render(fake, createFakeClock())

    await act(async () => {
      await result.current.flush()
    })

    expect(fake.saves).toHaveLength(0)
    expect(result.current.status).toBe('idle')
  })

  it('does not send the same entry twice when flushed concurrently', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result } = render(fake, clock)

    act(() => {
      result.current.change(paragraph('once'))
    })
    await act(async () => {
      await Promise.all([result.current.flush(), result.current.flush()])
    })

    expect(fake.saves).toHaveLength(1)
  })

  it('falls back to the system clock and the ADR-021 debounce', async () => {
    const fake = createFakeDraftClient()
    const store = createMemoryRecoveryStore()
    const { result } = renderHook(() =>
      useAutosave({ client: fake.client, store, documentVersion: 1, canSave: true }),
    )

    act(() => {
      result.current.change(paragraph('real timers'))
    })
    expect(store.read()?.savedAt).toBeGreaterThan(0)

    await act(async () => {
      await result.current.flush()
    })
    expect(result.current.status).toBe('saved')
  })
})

/**
 * A draft server with real version semantics: a save based on anything but
 * the current version is refused, and an applied save bumps it by one. Its
 * failure modes are the ones the audit saw — down (502 or no network), and
 * the worst one: the write is applied but the answer never arrives.
 */
type ServerMode = 'up' | 'down' | 'drops-answers'

function createFakeDraftServer(text = '') {
  let draft = { ast: paragraph(text), draftVersion: 1 }
  let mode: ServerMode = 'up'
  const requests: SaveCall[] = []
  const applied: SaveCall[] = []

  const client = (): DraftClient => ({
    load: async () => {
      if (mode === 'down') throw new TypeError('Failed to fetch')
      return { ...structuredClone(draft), baseRevision: null }
    },
    save: async (ast, expectedVersion) => {
      requests.push({ ast, expectedVersion })
      if (mode === 'down') return { status: 'unavailable', retryAfterMs: null }
      if (expectedVersion !== draft.draftVersion) {
        return { status: 'stale_version', currentVersion: draft.draftVersion }
      }
      // Stored as JSON, the way the database stores it.
      const stored: DocumentAst = JSON.parse(JSON.stringify(ast))
      draft = { ast: stored, draftVersion: expectedVersion + 1 }
      applied.push({ ast, expectedVersion })
      if (mode === 'drops-answers') return { status: 'unavailable', retryAfterMs: null }
      return { status: 'saved', draftVersion: draft.draftVersion, updatedAt: draft.draftVersion }
    },
  })

  return {
    client,
    requests,
    applied,
    get draft() {
      return draft
    },
    setMode(next: ServerMode) {
      mode = next
    },
  }
}

function renderWith(
  client: DraftClient,
  clock: FakeClock,
  extra: Partial<UseAutosaveOptions> = {},
) {
  const store = extra.store ?? createMemoryRecoveryStore()
  const connectivity = createFakeConnectivity()
  const view = renderHook(() =>
    useAutosave({
      client,
      store,
      documentVersion: 1,
      canSave: true,
      clock,
      debounceMs: 1000,
      random: () => 1,
      connectivity,
      ...extra,
    }),
  )
  return { ...view, store }
}

describe('useAutosave through a failing server (audit P0-1)', () => {
  it('never sticks on "saving" after a 502, and sends the edits made since', async () => {
    const server = createFakeDraftServer()
    const clock = createFakeClock()
    const { result, store } = renderWith(server.client(), clock)

    server.setMode('down')
    act(() => {
      result.current.change(paragraph('a'))
    })
    await tick(clock, 1000)

    expect(result.current.phase).toEqual({ status: 'retrying', attempt: 1, nextAt: 2000 })
    expect(store.read()?.ast).toEqual(paragraph('a'))

    // Typing goes on; nothing is lost and nothing is sent early.
    act(() => {
      result.current.change(paragraph('ab'))
    })
    await tick(clock, 999)
    expect(server.requests).toHaveLength(1)

    // The backoff doubles while the server stays down: 1s, 2s, 4s...
    await tick(clock, 1)
    expect(server.requests).toHaveLength(2)
    expect(result.current.phase).toEqual({ status: 'retrying', attempt: 2, nextAt: 4000 })

    server.setMode('up')
    await tick(clock, 2000)

    expect(result.current.status).toBe('saved')
    expect(server.draft).toEqual({ ast: paragraph('ab'), draftVersion: 2 })
    expect(store.read()).toBeUndefined()

    // And the loop is alive: the next edit is saved like any other.
    act(() => {
      result.current.change(paragraph('abc'))
    })
    await tick(clock, 1000)
    expect(server.draft).toEqual({ ast: paragraph('abc'), draftVersion: 3 })
  })

  it('caps the backoff at thirty seconds', async () => {
    const server = createFakeDraftServer()
    const clock = createFakeClock()
    const { result } = renderWith(server.client(), clock)

    server.setMode('down')
    act(() => {
      result.current.change(paragraph('a'))
    })
    await tick(clock, 1000)
    for (const wait of [2000, 4000, 8000, 16_000, 30_000, 30_000]) await tick(clock, wait)

    expect(server.requests).toHaveLength(7)
    expect(result.current.phase).toEqual({
      status: 'retrying',
      attempt: 7,
      nextAt: clock.now() + 30_000,
    })
  })

  it('honours Retry-After on a 429 or a 503', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result } = renderWith(fake.client, clock)

    fake.answer({ status: 'unavailable', retryAfterMs: 20_000 })
    act(() => {
      result.current.change(paragraph('a'))
    })
    await tick(clock, 1000)

    expect(result.current.phase).toEqual({ status: 'retrying', attempt: 1, nextAt: 21_000 })
  })

  it('says it is offline, and retries the moment the browser is back', async () => {
    const server = createFakeDraftServer()
    const clock = createFakeClock()
    const connectivity = createFakeConnectivity()
    const { result } = renderWith(server.client(), clock, { connectivity })

    act(() => {
      result.current.change(paragraph('on the train'))
    })
    act(() => {
      connectivity.setOnline(false)
    })
    expect(result.current.status).toBe('offline')

    act(() => {
      connectivity.setOnline(true)
    })
    await tick(clock, 0)

    expect(result.current.status).toBe('saved')
    expect(server.draft.ast).toEqual(paragraph('on the train'))
  })

  it('retries at once when the tab comes back into view', async () => {
    const server = createFakeDraftServer()
    const clock = createFakeClock()
    const connectivity = createFakeConnectivity()
    const { result } = renderWith(server.client(), clock, { connectivity })

    server.setMode('down')
    act(() => {
      result.current.change(paragraph('a'))
    })
    await tick(clock, 1000)
    expect(result.current.status).toBe('retrying')

    server.setMode('up')
    act(() => {
      connectivity.setVisible(false)
    })
    act(() => {
      connectivity.setVisible(true)
    })
    await tick(clock, 0)
    expect(result.current.status).toBe('saved')
  })

  it('stops on a refusal it cannot retry, keeps the edit, and resumes on Retry', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result, store } = renderWith(fake.client, clock)

    fake.answer({ status: 'rejected', message: 'The draft is too large' })
    act(() => {
      result.current.change(paragraph('big'))
    })
    await tick(clock, 1000)

    expect(result.current.phase).toEqual({ status: 'failed', reason: 'The draft is too large' })
    await tick(clock, 60_000)
    expect(fake.saves).toHaveLength(1)
    expect(store.read()?.ast).toEqual(paragraph('big'))

    fake.answer({ status: 'saved', draftVersion: 2, updatedAt: 2 })
    act(() => {
      result.current.retry()
    })
    await tick(clock, 0)
    expect(result.current.status).toBe('saved')
  })

  it('treats a client that throws as a refusal rather than freezing', async () => {
    const clock = createFakeClock()
    let throws = true
    const client: DraftClient = {
      load: async () => ({ ast: paragraph(''), draftVersion: 1, baseRevision: null }),
      save: async () => {
        if (throws) throw new Error('boom')
        return { status: 'saved', draftVersion: 2, updatedAt: 2 }
      },
    }
    const { result } = renderWith(client, clock)

    act(() => {
      result.current.change(paragraph('a'))
    })
    await tick(clock, 1000)
    expect(result.current.phase).toEqual({ status: 'failed', reason: 'boom' })

    // The next keystroke tries again by itself.
    throws = false
    act(() => {
      result.current.change(paragraph('ab'))
    })
    await tick(clock, 1000)
    expect(result.current.status).toBe('saved')
  })
})

describe('useAutosave when the API dies mid-save and comes back', () => {
  it('writes nothing twice, loses no character, and ends on exactly what was typed', async () => {
    const server = createFakeDraftServer()
    const clock = createFakeClock()
    const { result, store } = renderWith(server.client(), clock)

    act(() => {
      result.current.change(paragraph('Hello'))
    })
    await tick(clock, 1000)
    expect(server.draft).toEqual({ ast: paragraph('Hello'), draftVersion: 2 })

    // The server applies the next write, then dies before answering.
    server.setMode('drops-answers')
    act(() => {
      result.current.change(paragraph('Hello, wor'))
    })
    await tick(clock, 1000)
    expect(result.current.status).toBe('retrying')

    // It stays down while the author keeps typing.
    server.setMode('down')
    act(() => {
      result.current.change(paragraph('Hello, world'))
    })
    await tick(clock, 1000)
    expect(server.requests).toHaveLength(3)

    // It comes back. The retry is refused as stale — by our own lost write —
    // and is recognised as ours rather than reported as a conflict.
    server.setMode('up')
    await tick(clock, 4000)
    await tick(clock, 1000)

    expect(result.current.status).toBe('saved')
    expect(server.draft).toEqual({ ast: paragraph('Hello, world'), draftVersion: 4 })
    expect(server.applied).toEqual([
      { ast: paragraph('Hello'), expectedVersion: 1 },
      { ast: paragraph('Hello, wor'), expectedVersion: 2 },
      { ast: paragraph('Hello, world'), expectedVersion: 3 },
    ])
    expect(store.read()).toBeUndefined()
  })

  it('still reports a real conflict when the write that landed was not ours', async () => {
    const server = createFakeDraftServer()
    const clock = createFakeClock()
    const { result } = renderWith(server.client(), clock)
    const other = server.client()

    server.setMode('down')
    act(() => {
      result.current.change(paragraph('mine'))
    })
    await tick(clock, 1000)

    server.setMode('up')
    await other.save(paragraph('theirs'), 1)
    await tick(clock, 2000)

    expect(result.current.phase).toEqual({ status: 'conflict', currentVersion: 2 })
    expect(server.draft.ast).toEqual(paragraph('theirs'))
  })
})

describe('useAutosave when it cannot read the draft back', () => {
  /** Saves answer from a script; reading the draft back always fails. */
  function scriptedClient(...answers: DraftSaveResult[]) {
    const saves: SaveCall[] = []
    const client: DraftClient = {
      load: async () => {
        throw new TypeError('Failed to fetch')
      },
      save: async (ast, expectedVersion) => {
        saves.push({ ast, expectedVersion })
        return answers.shift() ?? { status: 'saved', draftVersion: 9, updatedAt: 9 }
      },
    }
    return { client, saves }
  }

  it('retries later when a lost answer is followed by a 409 it cannot check', async () => {
    const { client, saves } = scriptedClient(
      { status: 'unavailable', retryAfterMs: null },
      { status: 'stale_version', currentVersion: 2 },
    )
    const clock = createFakeClock()
    const { result } = renderWith(client, clock)

    act(() => {
      result.current.change(paragraph('mine'))
    })
    await tick(clock, 1000)
    await tick(clock, 2000)

    // Neither a conflict nor a success it cannot prove: it tries again.
    expect(result.current.phase).toMatchObject({ status: 'retrying', attempt: 2 })
    expect(saves).toHaveLength(2)
  })

  it('stays in conflict when keeping mine cannot learn the newer version', async () => {
    const { client, saves } = scriptedClient({ status: 'stale_version', currentVersion: 0 })
    const clock = createFakeClock()
    const { result } = renderWith(client, clock)

    act(() => {
      result.current.change(paragraph('mine'))
    })
    await tick(clock, 1000)
    await act(async () => {
      await result.current.keepMine()
    })
    await tick(clock, 5000)

    expect(result.current.phase).toEqual({ status: 'conflict', currentVersion: 0 })
    expect(saves).toHaveLength(1)
  })
})

describe('useAutosave keeping mine', () => {
  it('does nothing when there is no conflict to resolve', async () => {
    const server = createFakeDraftServer()
    const clock = createFakeClock()
    const { result } = renderWith(server.client(), clock)

    await act(async () => {
      await result.current.keepMine()
    })
    expect(result.current.phase).toEqual({ status: 'idle' })
  })

  it('moves an idle tab onto the newer version without inventing an edit to send', async () => {
    const server = createFakeDraftServer()
    const channels = createMemoryDraftChannels()
    const other = channels.channel()
    const clock = createFakeClock()
    const { result } = renderWith(server.client(), clock, { channel: channels.channel() })

    act(() => {
      other.publish({ draftVersion: 5 })
    })
    await act(async () => {
      await result.current.keepMine()
    })

    expect(result.current.phase).toEqual({ status: 'idle' })
    expect(result.current.draftVersion).toBe(5)
    expect(server.requests).toHaveLength(0)
  })

  it('says why when a client fails with something that is not an Error', async () => {
    const clock = createFakeClock()
    const client: DraftClient = {
      load: async () => ({ ast: paragraph(''), draftVersion: 1, baseRevision: null }),
      // A rejection carrying no Error at all, as a misbehaving library might.
      save: () => Promise.reject(new Response(null, { status: 599 })),
    }
    const { result } = renderWith(client, clock)

    act(() => {
      result.current.change(paragraph('a'))
    })
    await tick(clock, 1000)
    expect(result.current.phase).toEqual({
      status: 'failed',
      reason: 'The draft could not be saved',
    })
  })
})

describe('useAutosave across two tabs of the same browser (audit P0-5)', () => {
  it('learns at once that the other tab saved, and never overwrites it silently', async () => {
    const server = createFakeDraftServer('shared')
    const channels = createMemoryDraftChannels()
    const clock = createFakeClock()
    const tabA = renderWith(server.client(), clock, { channel: channels.channel() })
    const tabB = renderWith(server.client(), clock, { channel: channels.channel() })

    act(() => {
      tabA.result.current.change(paragraph('TAB1'))
    })
    await tick(clock, 1000)
    expect(tabA.result.current.status).toBe('saved')

    // Before tab B types a thing, it already knows.
    expect(tabB.result.current.phase).toEqual({ status: 'conflict', currentVersion: 2 })

    act(() => {
      tabB.result.current.change(paragraph('TAB2'))
    })
    await tick(clock, 5000)
    expect(server.draft).toEqual({ ast: paragraph('TAB1'), draftVersion: 2 })
    expect(tabB.store.read()?.ast).toEqual(paragraph('TAB2'))
  })
})

/**
 * The R5 section 4 partition scenario, driven through both hooks at once: the
 * component keeps accepting edits throughout, but nothing reaches the server until
 * a heartbeat has actually re-validated the lock.
 */
describe('editing through a network partition', () => {
  interface Session {
    lock: ReturnType<typeof useDocumentLock>
    autosave: ReturnType<typeof useAutosave>
  }

  const PARTITIONED = 'partitioned'

  function createSession(heartbeats: () => HeartbeatResult | typeof PARTITIONED) {
    const clock = createFakeClock()
    const store = createMemoryRecoveryStore()
    const draft = createFakeDraftClient()
    const lockCalls = { release: 0 }
    const lockClient: LockClient = {
      acquire: async () => ({ status: 'acquired', lock }),
      heartbeat: async () => {
        const answer = heartbeats()
        if (answer === PARTITIONED) throw new Error('network unreachable')
        return answer
      },
      release: async () => {
        lockCalls.release += 1
      },
      takeover: async () => ({ status: 'acquired', lock }),
    }

    const connectivity = createFakeConnectivity()
    const view = renderHook((): Session => {
      const documentLock = useDocumentLock({
        client: lockClient,
        clock,
        heartbeatIntervalMs: 15_000,
        retryBackoff: { baseMs: 200, capMs: 2000 },
        random: () => 1,
        connectivity,
      })
      const autosave = useAutosave({
        client: draft.client,
        store,
        documentVersion: 1,
        canSave: documentLock.canAutosave,
        clock,
        debounceMs: 1000,
        connectivity,
      })
      return { lock: documentLock, autosave }
    })

    return { ...view, clock, store, draft }
  }

  it('escalates, buffers, and resumes only after a heartbeat succeeds', async () => {
    let answer: HeartbeatResult | typeof PARTITIONED = { status: 'alive', expiresAt: 120_000 }
    const { result, clock, store, draft } = createSession(() => answer)

    await act(async () => {
      await result.current.lock.acquire()
    })
    act(() => {
      result.current.autosave.change(paragraph('safe'))
    })
    await tick(clock, 1000)
    expect(draft.saves).toHaveLength(1)

    // The network goes away. One missed heartbeat is "reconnecting".
    answer = PARTITIONED
    await tick(clock, 15_000)
    expect(result.current.lock.status).toBe('reconnecting')
    expect(result.current.lock.canAutosave).toBe(false)

    // Editing continues; the edits go to the recovery buffer and no further.
    act(() => {
      result.current.autosave.change(paragraph('typed while offline'))
    })
    await tick(clock, 200)
    expect(result.current.lock.status).toBe('at_risk')
    expect(result.current.lock.missedHeartbeats).toBe(2)
    expect(draft.saves).toHaveLength(1)
    expect(store.read()?.ast).toEqual(paragraph('typed while offline'))

    // Requests start succeeding again, but autosave stays stopped until the lock
    // itself has been re-validated.
    await tick(clock, 5000)
    expect(draft.saves).toHaveLength(1)

    // The next retry is at most the backoff cap away (audit P0-4), not instant.
    answer = { status: 'alive', expiresAt: 300_000 }
    await tick(clock, 2000)
    expect(result.current.lock.status).toBe('held')
    expect(result.current.lock.canAutosave).toBe(true)

    await tick(clock, 1000)
    expect(draft.saves).toHaveLength(2)
    expect(draft.saves[1]?.ast).toEqual(paragraph('typed while offline'))
    expect(store.read()).toBeUndefined()
  })

  it('keeps the buffered edits when the reconnected heartbeat says the lease lapsed', async () => {
    let answer: HeartbeatResult | typeof PARTITIONED = { status: 'alive', expiresAt: 120_000 }
    const { result, clock, store, draft } = createSession(() => answer)

    await act(async () => {
      await result.current.lock.acquire()
    })
    answer = PARTITIONED
    await tick(clock, 15_000)
    act(() => {
      result.current.autosave.change(paragraph('unsent'))
    })
    await tick(clock, 200)
    expect(result.current.lock.status).toBe('at_risk')

    answer = { status: 'expired' }
    await tick(clock, 200)

    expect(result.current.lock.status).toBe('lost')
    expect(result.current.autosave.status).toBe('dirty')
    expect(store.read()?.ast).toEqual(paragraph('unsent'))
    expect(draft.saves).toHaveLength(0)

    await tick(clock, 60_000)
    expect(draft.saves).toHaveLength(0)
  })

  it('keeps the buffered edits when somebody else has taken the document', async () => {
    let answer: HeartbeatResult | typeof PARTITIONED = { status: 'alive', expiresAt: 120_000 }
    const { result, clock, store, draft } = createSession(() => answer)

    await act(async () => {
      await result.current.lock.acquire()
    })
    answer = PARTITIONED
    await tick(clock, 15_000)
    act(() => {
      result.current.autosave.change(paragraph('unsent'))
    })
    await tick(clock, 200)

    answer = { status: 'taken_over', holder }
    await tick(clock, 200)

    expect(result.current.lock.status).toBe('held_by_other')
    expect(result.current.lock.holder).toEqual(holder)
    expect(store.read()?.ast).toEqual(paragraph('unsent'))
    expect(draft.saves).toHaveLength(0)
  })
})
