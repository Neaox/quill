import {
  documentCreated,
  documentMoved,
  documentNested,
  documentPublished,
  documentRenamed,
  sourceDisconnected,
  sourceSyncStateChanged,
} from '@quill/application'
import { createEventBus } from '@quill/application'
import type { EventBus, SourceSyncState } from '@quill/application'
import type { DocumentId, WorkspaceId } from '@quill/domain'

/**
 * Who is listening to a workspace's live stream, and what each is told
 * (ADR-063).
 *
 * The hub listens to the in-process bus (ADR-056) and hands each change to
 * the connections open on the workspace it happened in, and to no others.
 * Nothing is sent as it arrives: a connection gathers what happened for a
 * moment (`flushMs`), then asks, as its reader and at that moment, whether
 * the reader may see each thing, and sends only what they may. A sync that
 * publishes three hundred pages is one short burst of checks per reader,
 * not three hundred messages; more than `maxPending` pages at once is sent
 * as one `reset`, telling the reader to read again what they have open.
 *
 * **What a message carries.** Ids and a revision, never a title, a path or a
 * reason: what changed is read again through the ordinary routes, which
 * check the reader's access themselves. The stream says when to ask, never
 * what the answer is.
 *
 * **What it is bounded by.** So many connections in all, so many per reader,
 * a heartbeat that also checks the session and the reader's access to the
 * workspace (closing the stream when either is gone), and a lifetime after
 * which the server closes it and the browser opens it again, through the
 * route's own checks.
 *
 * **Only while the workspace reads from a repository.** Disconnecting the
 * source (ADR-061) closes every stream open on the workspace, and the route
 * refuses a new one, so a disconnected workspace streams nothing.
 */

/** What the stream sends: an event name and its data, as JSON. */
export type LiveMessage =
  | {
      readonly event: 'sync'
      readonly data: { readonly state: SourceSyncState; readonly changed: boolean }
    }
  | {
      readonly event: 'document'
      readonly data: { readonly documentId: DocumentId; readonly revision: string }
    }
  | { readonly event: 'tree'; readonly data: Record<string, never> }
  | { readonly event: 'reset'; readonly data: Record<string, never> }

/** One stream's end: what the route writes to, and how the hub ends it. */
export interface LiveConnection {
  send(message: LiveMessage): void
  /** A comment line, which keeps proxies from closing a quiet stream. */
  heartbeat(): void
  /** Ends the response. The hub calls it once, and forgets the connection. */
  close(): void
}

/** What a reader may see, asked afresh each time, as the reader. */
export interface LiveAccess {
  /** The reader's session still stands. */
  sessionAlive(): Promise<boolean>
  canViewWorkspace(workspaceId: WorkspaceId): Promise<boolean>
  canViewDocument(documentId: DocumentId): Promise<boolean>
}

export interface LiveReader {
  /** Whose connections are counted together. */
  readonly key: string
  readonly access: LiveAccess
}

export interface LiveHubOptions {
  readonly maxConnections: number
  readonly maxPerReader: number
  readonly heartbeatMs: number
  readonly maxLifetimeMs: number
  readonly flushMs: number
  readonly maxPending: number
  /** Where a failed check goes; the connection is closed after one. */
  readonly onError: (error: unknown) => void
}

export const DEFAULT_LIVE_OPTIONS = {
  maxConnections: 2_000,
  // Under HTTP/1.1 a browser opens six connections to a host; a reader keeps
  // most of them for everything else.
  maxPerReader: 4,
  heartbeatMs: 25_000,
  maxLifetimeMs: 10 * 60_000,
  flushMs: 300,
  maxPending: 50,
} as const satisfies Omit<LiveHubOptions, 'onError'>

export type OpenResult =
  | { readonly kind: 'opened'; readonly close: () => void }
  | { readonly kind: 'full' }

export interface LiveHub {
  /** Starts telling a connection about a workspace, or refuses when a bound is reached. */
  open(reader: LiveReader, workspaceId: WorkspaceId, connection: LiveConnection): OpenResult
  /** How many connections are open, for a test and for the health of the process. */
  size(): number
  /** Closes every connection and stops listening: the server is shutting down. */
  close(): void
}

interface DocumentChange {
  /** The newest revision published, if it was published. */
  readonly revision: string | null
  /** Whether its place or title in the tree changed. */
  readonly tree: boolean
}

interface Pending {
  readonly sync: { readonly state: SourceSyncState; readonly changed: boolean } | null
  readonly documents: ReadonlyMap<DocumentId, DocumentChange>
  /** More documents changed than are checked one by one. */
  readonly overflow: boolean
}

const NOTHING: Pending = { sync: null, documents: new Map(), overflow: false }

class Subscriber {
  readonly #reader: LiveReader
  readonly #workspaceId: WorkspaceId
  readonly #connection: LiveConnection
  readonly #options: LiveHubOptions
  readonly #onClosed: (subscriber: Subscriber) => void
  #sync: Pending['sync'] = null
  #documents = new Map<DocumentId, DocumentChange>()
  #overflow = false
  #flushTimer: ReturnType<typeof setTimeout> | null = null
  #busy = false
  #closed = false
  readonly #heartbeat: ReturnType<typeof setInterval>
  readonly #lifetime: ReturnType<typeof setTimeout>

  constructor(
    reader: LiveReader,
    workspaceId: WorkspaceId,
    connection: LiveConnection,
    options: LiveHubOptions,
    onClosed: (subscriber: Subscriber) => void,
  ) {
    this.#reader = reader
    this.#workspaceId = workspaceId
    this.#connection = connection
    this.#options = options
    this.#onClosed = onClosed
    this.#heartbeat = setInterval(() => {
      void this.#beat()
    }, options.heartbeatMs)
    this.#lifetime = setTimeout(() => {
      this.close()
    }, options.maxLifetimeMs)
  }

  get readerKey(): string {
    return this.#reader.key
  }

  get workspaceId(): WorkspaceId {
    return this.#workspaceId
  }

  syncChanged(state: SourceSyncState, changed: boolean): void {
    // A start and an end inside one moment are told as the end, and a change is never forgotten.
    this.#sync = { state, changed: changed || (this.#sync?.changed ?? false) }
    this.#schedule()
  }

  documentChanged(documentId: DocumentId, change: { revision?: string; tree?: boolean }): void {
    const before = this.#documents.get(documentId)
    if (before === undefined && this.#documents.size >= this.#options.maxPending) {
      this.#overflow = true
    } else {
      this.#documents.set(documentId, {
        revision: change.revision ?? before?.revision ?? null,
        tree: change.tree === true || before?.tree === true,
      })
    }
    this.#schedule()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    clearInterval(this.#heartbeat)
    clearTimeout(this.#lifetime)
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer)
    this.#connection.close()
    this.#onClosed(this)
  }

  #schedule(): void {
    if (this.#closed || this.#flushTimer !== null || this.#busy) return
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null
      void this.#flush()
    }, this.#options.flushMs)
  }

  #take(): Pending {
    const pending = { sync: this.#sync, documents: this.#documents, overflow: this.#overflow }
    this.#sync = NOTHING.sync
    this.#documents = new Map()
    this.#overflow = false
    return pending
  }

  /** The session and the workspace, which every send and every heartbeat is preceded by. */
  async #stillAllowed(): Promise<boolean> {
    const { access } = this.#reader
    return (await access.sessionAlive()) && (await access.canViewWorkspace(this.#workspaceId))
  }

  /** Runs one check-and-send at a time; anything that arrives meanwhile waits for the next. */
  async #exclusive(work: () => Promise<void>): Promise<void> {
    this.#busy = true
    try {
      await work()
    } catch (error) {
      this.#options.onError(error)
      this.close()
    } finally {
      this.#busy = false
    }
    if (this.#sync !== null || this.#documents.size > 0 || this.#overflow) this.#schedule()
  }

  async #beat(): Promise<void> {
    if (this.#busy) return
    await this.#exclusive(async () => {
      if (!(await this.#stillAllowed())) this.close()
      else if (!this.#closed) this.#connection.heartbeat()
    })
  }

  async #flush(): Promise<void> {
    if (this.#busy) return
    await this.#exclusive(async () => {
      const pending = this.#take()
      if (!(await this.#stillAllowed())) {
        this.close()
        return
      }
      const messages = await this.#visible(pending)
      if (this.#closed) return
      for (const message of messages) this.#connection.send(message)
    })
  }

  /** What of `pending` this reader may be told, checked now, as them. */
  async #visible(pending: Pending): Promise<LiveMessage[]> {
    const messages: LiveMessage[] = []
    if (pending.sync !== null) messages.push({ event: 'sync', data: pending.sync })
    if (pending.overflow) return [...messages, { event: 'reset', data: {} }]
    let tree = false
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one reader's checks, at most maxPending, asked in turn so a burst does not take many connections from the pool
    for (const [documentId, change] of pending.documents) {
      if (!(await this.#reader.access.canViewDocument(documentId))) continue
      if (change.revision !== null) {
        messages.push({ event: 'document', data: { documentId, revision: change.revision } })
      }
      tree ||= change.tree
    }
    if (tree) messages.push({ event: 'tree', data: {} })
    return messages
  }
}

export function createLiveHub(bus: EventBus, options: LiveHubOptions): LiveHub {
  const byWorkspace = new Map<WorkspaceId, Set<Subscriber>>()
  const perReader = new Map<string, number>()
  let total = 0

  const each = (workspaceId: WorkspaceId, tell: (subscriber: Subscriber) => void) => {
    for (const subscriber of byWorkspace.get(workspaceId) ?? []) tell(subscriber)
  }

  const treeChanged = (event: {
    readonly workspaceId: WorkspaceId
    readonly documentId: DocumentId
  }) => {
    each(event.workspaceId, (subscriber) => {
      subscriber.documentChanged(event.documentId, { tree: true })
    })
  }

  const unsubscribe = [
    bus.subscribe(sourceSyncStateChanged, (event) => {
      each(event.workspaceId, (subscriber) => {
        subscriber.syncChanged(event.state, event.changed)
      })
    }),
    // The workspace is native now: its streams end, and the route opens no more.
    bus.subscribe(sourceDisconnected, (event) => {
      for (const subscriber of Array.from(byWorkspace.get(event.workspaceId) ?? [])) {
        subscriber.close()
      }
    }),
    bus.subscribe(documentPublished, (event) => {
      each(event.workspaceId, (subscriber) => {
        subscriber.documentChanged(event.documentId, { revision: event.revision })
      })
    }),
    bus.subscribe(documentCreated, treeChanged),
    bus.subscribe(documentRenamed, treeChanged),
    bus.subscribe(documentMoved, treeChanged),
    bus.subscribe(documentNested, treeChanged),
  ]

  const forget = (subscriber: Subscriber) => {
    const set = byWorkspace.get(subscriber.workspaceId)
    /* v8 ignore next -- close() runs once per subscriber, so it is always still in its set */
    if (set === undefined || !set.delete(subscriber)) return
    if (set.size === 0) byWorkspace.delete(subscriber.workspaceId)
    total -= 1
    count(subscriber.readerKey, -1)
  }

  /** Moves a reader's count of streams, forgetting a reader with none. */
  const count = (key: string, by: number) => {
    const next = (perReader.get(key) ?? 0) + by
    if (next === 0) perReader.delete(key)
    else perReader.set(key, next)
  }

  return {
    open(reader, workspaceId, connection) {
      const mine = perReader.get(reader.key) ?? 0
      if (total >= options.maxConnections || mine >= options.maxPerReader) return { kind: 'full' }
      const subscriber = new Subscriber(reader, workspaceId, connection, options, forget)
      const set = byWorkspace.get(workspaceId) ?? new Set<Subscriber>()
      set.add(subscriber)
      byWorkspace.set(workspaceId, set)
      count(reader.key, 1)
      total += 1
      return {
        kind: 'opened',
        close: () => {
          subscriber.close()
        },
      }
    },
    size: () => total,
    close() {
      for (const stop of unsubscribe) stop()
      for (const set of Array.from(byWorkspace.values())) {
        for (const subscriber of Array.from(set)) subscriber.close()
      }
    },
  }
}

const ignore = () => undefined

/**
 * A hub that hears nothing, for a process that serves no streams: a script,
 * or the description of the routes. A stream opened on it stays quiet.
 */
export function createIdleLiveHub(): LiveHub {
  return createLiveHub(createEventBus({ onError: ignore }), {
    ...DEFAULT_LIVE_OPTIONS,
    onError: ignore,
  })
}
