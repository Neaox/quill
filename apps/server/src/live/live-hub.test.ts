import {
  createEventBus,
  documentCreated,
  documentMoved,
  documentNested,
  documentPublished,
  documentRenamed,
  sourceDisconnected,
  sourceSyncStateChanged,
} from '@quill/application'
import type { EventBus, EventDefinition } from '@quill/application'
import { documentId, workspaceId } from '@quill/domain'
import type { DocumentId, WorkspaceId } from '@quill/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createIdleLiveHub, createLiveHub, DEFAULT_LIVE_OPTIONS } from './live-hub.ts'
import type {
  LiveAccess,
  LiveConnection,
  LiveHub,
  LiveHubOptions,
  LiveMessage,
} from './live-hub.ts'

const HERE = workspaceId('00000000-0000-4000-8000-000000000001')
const THERE = workspaceId('00000000-0000-4000-8000-000000000002')
const OPEN = documentId('00000000-0000-4000-8000-0000000000a1')
const HIDDEN = documentId('00000000-0000-4000-8000-0000000000a2')

const OPTIONS = {
  maxConnections: 3,
  maxPerReader: 2,
  heartbeatMs: 1_000,
  maxLifetimeMs: 60_000,
  flushMs: 50,
  maxPending: 3,
} as const

interface Recorder extends LiveConnection {
  readonly messages: LiveMessage[]
  readonly beats: number
  readonly closed: boolean
}

function recorder(): Recorder {
  const state = { messages: [] as LiveMessage[], beats: 0, closed: false }
  return {
    get messages() {
      return state.messages
    },
    get beats() {
      return state.beats
    },
    get closed() {
      return state.closed
    },
    send(message) {
      state.messages.push(message)
    },
    heartbeat() {
      state.beats += 1
    },
    close() {
      state.closed = true
    },
  }
}

interface Rules {
  session: boolean
  workspace: boolean | Error
  hidden: readonly DocumentId[]
}

function reader(key: string, rules: Rules) {
  const access: LiveAccess = {
    sessionAlive: async () => rules.session,
    canViewWorkspace: async () => {
      if (rules.workspace instanceof Error) throw rules.workspace
      return rules.workspace
    },
    canViewDocument: async (id) => !rules.hidden.includes(id),
  }
  return { key, access }
}

/** A check held until the test lets it answer. */
function held(): { gate: Promise<void>; release: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>()
  return { gate: promise, release: resolve }
}

let bus: EventBus
let hub: LiveHub
let errors: unknown[]

function build(options: Partial<LiveHubOptions> = {}) {
  errors = []
  bus = createEventBus({ onError: (error) => errors.push(error) })
  hub = createLiveHub(bus, {
    ...OPTIONS,
    ...options,
    onError: (error) => errors.push(error),
  })
}

async function publish<P extends { readonly version: number }>(
  definition: EventDefinition<P>,
  payload: Omit<P, 'version'>,
) {
  await bus.publish({ type: definition.type, payload: { version: 1, ...payload } })
}

const published = (doc: DocumentId, workspace: WorkspaceId = HERE) =>
  publish(documentPublished, {
    documentId: doc,
    workspaceId: workspace,
    revision: `rev-${doc.slice(-2)}`,
    publishedBy: null,
  } as never)

beforeEach(() => {
  vi.useFakeTimers()
  build()
})

afterEach(() => {
  hub.close()
  vi.useRealTimers()
})

describe('the live hub', () => {
  it('gathers a moment of changes, and tells a reader only what they may see', async () => {
    const connection = recorder()
    hub.open(
      reader('viewer', { session: true, workspace: true, hidden: [HIDDEN] }),
      HERE,
      connection,
    )
    await publish(sourceSyncStateChanged, { workspaceId: HERE, state: 'started', changed: false })
    await published(OPEN)
    await published(HIDDEN)
    await publish(documentRenamed, {
      workspaceId: HERE,
      documentId: HIDDEN,
      from: 'a',
      to: 'b',
    } as never)
    await publish(sourceSyncStateChanged, { workspaceId: HERE, state: 'finished', changed: true })
    expect(connection.messages).toEqual([])

    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    expect(connection.messages).toEqual([
      { event: 'sync', data: { state: 'finished', changed: true } },
      { event: 'document', data: { documentId: OPEN, revision: 'rev-a1' } },
    ])
  })

  it('keeps a change through a later quiet end, and tells of a tree that moved', async () => {
    const connection = recorder()
    hub.open(reader('viewer', { session: true, workspace: true, hidden: [] }), HERE, connection)
    await publish(sourceSyncStateChanged, { workspaceId: HERE, state: 'finished', changed: true })
    await publish(sourceSyncStateChanged, { workspaceId: HERE, state: 'finished', changed: false })
    const base = { workspaceId: HERE, documentId: OPEN }
    await publish(documentCreated, { ...base, title: 'Open', createdBy: 'u-1' } as never)
    await publish(documentMoved, {
      ...base,
      fromCollectionId: 'c-1',
      toCollectionId: 'c-2',
    } as never)
    await publish(documentNested, { ...base, fromParentId: null, toParentId: HIDDEN } as never)
    await publish(documentRenamed, { ...base, documentId: HIDDEN, from: 'a', to: 'b' } as never)
    await published(OPEN)
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    expect(connection.messages).toEqual([
      { event: 'sync', data: { state: 'finished', changed: true } },
      { event: 'document', data: { documentId: OPEN, revision: 'rev-a1' } },
      { event: 'tree', data: {} },
    ])
  })

  it('tells nothing of another workspace', async () => {
    const connection = recorder()
    hub.open(reader('viewer', { session: true, workspace: true, hidden: [] }), HERE, connection)
    await published(OPEN, THERE)
    await publish(sourceSyncStateChanged, { workspaceId: THERE, state: 'started', changed: false })
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs * 4)
    expect(connection.messages).toEqual([])
  })

  it('says "read again" once, rather than checking a burst page by page', async () => {
    const connection = recorder()
    hub.open(reader('viewer', { session: true, workspace: true, hidden: [] }), HERE, connection)
    for (let i = 0; i < OPTIONS.maxPending + 2; i += 1) {
      await published(documentId(`00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`))
    }
    await published(documentId('00000000-0000-4000-8000-000000000100'))
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    expect(connection.messages).toEqual([{ event: 'reset', data: {} }])
  })

  it('sends what arrives during a check in the next moment', async () => {
    const { gate, release } = held()
    const connection = recorder()
    const slow = reader('viewer', { session: true, workspace: true, hidden: [] })
    hub.open(
      {
        key: 'viewer',
        access: { ...slow.access, sessionAlive: async () => gate.then(() => true) },
      },
      HERE,
      connection,
    )
    await published(OPEN)
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    await published(HIDDEN)
    // A heartbeat while a check is running waits its turn.
    await vi.advanceTimersByTimeAsync(OPTIONS.heartbeatMs)
    release()
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    expect(connection.messages.map((m) => m.event === 'document' && m.data.documentId)).toEqual([
      OPEN,
      HIDDEN,
    ])
  })

  it('keeps a quiet stream open with heartbeats, and ends it when its time is up', async () => {
    const connection = recorder()
    hub.open(reader('viewer', { session: true, workspace: true, hidden: [] }), HERE, connection)
    await vi.advanceTimersByTimeAsync(OPTIONS.heartbeatMs * 2)
    expect(connection.beats).toBe(2)
    await vi.advanceTimersByTimeAsync(OPTIONS.maxLifetimeMs)
    expect(connection.closed).toBe(true)
    expect(hub.size()).toBe(0)
  })

  it.each([
    ['the session ended', { session: false, workspace: true }],
    ['the workspace is no longer theirs to read', { session: true, workspace: false }],
  ])('ends the stream at the next heartbeat when %s', async (_, rules) => {
    const connection = recorder()
    hub.open(reader('viewer', { ...rules, hidden: [] }), HERE, connection)
    await vi.advanceTimersByTimeAsync(OPTIONS.heartbeatMs)
    expect(connection.closed).toBe(true)
    expect(connection.beats).toBe(0)
  })

  it('ends the stream, sending nothing, when access is gone by the time a change is told', async () => {
    const rules: Rules = { session: true, workspace: true, hidden: [] }
    const connection = recorder()
    hub.open(reader('viewer', rules), HERE, connection)
    await published(OPEN)
    rules.workspace = false
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    expect(connection.messages).toEqual([])
    expect(connection.closed).toBe(true)
  })

  it('ends a stream whose check fails, and reports why', async () => {
    const failure = new Error('the database went away')
    const connection = recorder()
    hub.open(reader('viewer', { session: true, workspace: failure, hidden: [] }), HERE, connection)
    await vi.advanceTimersByTimeAsync(OPTIONS.heartbeatMs)
    expect(connection.closed).toBe(true)
    expect(errors).toEqual([failure])
  })

  it('sends nothing to a stream closed while its check ran', async () => {
    const { gate, release } = held()
    const connection = recorder()
    const opened = hub.open(
      {
        key: 'viewer',
        access: {
          sessionAlive: async () => true,
          canViewWorkspace: async () => true,
          canViewDocument: async () => gate.then(() => true),
        },
      },
      HERE,
      connection,
    )
    await published(OPEN)
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    if (opened.kind === 'opened') opened.close()
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.messages).toEqual([])
  })

  it('closes a stream once, however often it is asked to, and drops what was waiting', async () => {
    const connection = recorder()
    const opened = hub.open(
      reader('viewer', { session: true, workspace: true, hidden: [] }),
      HERE,
      connection,
    )
    await published(OPEN)
    if (opened.kind === 'opened') {
      opened.close()
      opened.close()
    }
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    expect(connection.messages).toEqual([])
    expect(hub.size()).toBe(0)
  })

  it('lets a moment that comes due during a heartbeat wait for it', async () => {
    const { gate, release } = held()
    let calls = 0
    const connection = recorder()
    hub.open(
      {
        key: 'viewer',
        access: {
          // The heartbeat's check is the first, and is held.
          sessionAlive: async () => (calls++ === 0 ? gate.then(() => true) : true),
          canViewWorkspace: async () => true,
          canViewDocument: async () => true,
        },
      },
      HERE,
      connection,
    )
    await vi.advanceTimersByTimeAsync(OPTIONS.heartbeatMs - 10)
    await published(OPEN)
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    expect(connection.messages).toEqual([])
    release()
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    expect(connection.beats).toBe(1)
    expect(connection.messages).toEqual([
      { event: 'document', data: { documentId: OPEN, revision: 'rev-a1' } },
    ])
  })

  it('does not beat a stream that closed while its heartbeat was checked', async () => {
    const { gate, release } = held()
    const connection = recorder()
    const opened = hub.open(
      {
        key: 'viewer',
        access: {
          sessionAlive: async () => gate.then(() => true),
          canViewWorkspace: async () => true,
          canViewDocument: async () => true,
        },
      },
      HERE,
      connection,
    )
    await vi.advanceTimersByTimeAsync(OPTIONS.heartbeatMs)
    if (opened.kind === 'opened') opened.close()
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.beats).toBe(0)
  })

  it('closes the streams of a workspace whose source is disconnected, and tells them nothing', async () => {
    const here = recorder()
    const there = recorder()
    const allowed = { session: true, workspace: true, hidden: [] }
    hub.open(reader('ada', allowed), HERE, here)
    hub.open(reader('cy', allowed), THERE, there)
    await published(OPEN)
    await publish(sourceDisconnected, { workspaceId: HERE, disconnectedBy: 'u-1' } as never)
    expect(here.closed).toBe(true)
    expect(there.closed).toBe(false)
    expect(hub.size()).toBe(1)
    // What was waiting for the moment is dropped with the stream.
    await published(OPEN)
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    expect(here.messages).toEqual([])
  })

  it('bounds the streams, in all and for each reader', () => {
    const allowed = { session: true, workspace: true, hidden: [] }
    const a = hub.open(reader('ada', allowed), HERE, recorder())
    expect(hub.open(reader('ada', allowed), HERE, recorder()).kind).toBe('opened')
    expect(hub.open(reader('ada', allowed), HERE, recorder()).kind).toBe('full')
    expect(hub.open(reader('cy', allowed), THERE, recorder()).kind).toBe('opened')
    expect(hub.open(reader('di', allowed), HERE, recorder()).kind).toBe('full')
    if (a.kind === 'opened') a.close()
    expect(hub.size()).toBe(2)
    expect(hub.open(reader('ada', allowed), HERE, recorder()).kind).toBe('opened')
  })

  it('closes every stream and stops listening when it is closed', async () => {
    const connection = recorder()
    hub.open(reader('viewer', { session: true, workspace: true, hidden: [] }), HERE, connection)
    hub.close()
    expect(connection.closed).toBe(true)
    expect(hub.size()).toBe(0)
    await published(OPEN)
    await vi.advanceTimersByTimeAsync(OPTIONS.flushMs)
    expect(connection.messages).toEqual([])
  })

  it('has an idle hub for a process that serves no streams, which drops what fails', async () => {
    const idle = createIdleLiveHub()
    const connection = recorder()
    idle.open(
      reader('viewer', { session: true, workspace: new Error('no database'), hidden: [] }),
      HERE,
      connection,
    )
    await vi.advanceTimersByTimeAsync(DEFAULT_LIVE_OPTIONS.heartbeatMs)
    expect(connection.closed).toBe(true)
    idle.close()
  })

  it('has defaults a browser can live with', () => {
    expect(DEFAULT_LIVE_OPTIONS.maxPerReader).toBeLessThan(6)
    expect(DEFAULT_LIVE_OPTIONS.heartbeatMs).toBeLessThan(30_000)
  })
})
