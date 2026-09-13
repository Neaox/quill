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
import { createMemoryRecoveryStore } from './recovery-store.ts'
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
    expect(result.current.status).toBe('pending')
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

    expect(result.current.status).toBe('pending')
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

    expect(result.current.status).toBe('pending')
    expect(store.read()?.ast).toEqual(paragraph('second'))

    await tick(clock, 1000)
    expect(fake.saves.map((call) => call.ast)).toEqual([paragraph('first'), paragraph('second')])
    expect(store.read()).toBeUndefined()
  })
})

describe('useAutosave conflicts', () => {
  it('stops and asks for a re-read when another tab got there first', async () => {
    const fake = createFakeDraftClient()
    const clock = createFakeClock()
    const { result, store, rerender } = render(fake, clock)

    fake.answer({ status: 'stale_version', currentVersion: 7 })
    act(() => {
      result.current.change(paragraph('mine'))
    })
    await tick(clock, 1000)

    expect(result.current.status).toBe('stale')
    expect(store.read()?.ast).toEqual(paragraph('mine'))

    // No silent retry against a version we already know is wrong.
    await tick(clock, 10_000)
    expect(fake.saves).toHaveLength(1)

    // The caller re-reads and hands the fresh version back.
    fake.answer({ status: 'saved', draftVersion: 8, updatedAt: 8000 })
    rerender({ canSave: true, documentVersion: 7 })
    act(() => {
      result.current.change(paragraph('mine again'))
    })
    await tick(clock, 1000)

    expect(fake.saves[1]).toEqual({ ast: paragraph('mine again'), expectedVersion: 7 })
    expect(result.current.status).toBe('saved')
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
    expect(result.current.status).toBe('pending')

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
    expect(result.current.status).toBe('pending')
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

    const view = renderHook((): Session => {
      const documentLock = useDocumentLock({
        client: lockClient,
        clock,
        heartbeatIntervalMs: 15_000,
        retryDelayMs: 200,
      })
      const autosave = useAutosave({
        client: draft.client,
        store,
        documentVersion: 1,
        canSave: documentLock.canAutosave,
        clock,
        debounceMs: 1000,
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

    answer = { status: 'alive', expiresAt: 300_000 }
    await tick(clock, 200)
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
    expect(result.current.autosave.status).toBe('pending')
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
