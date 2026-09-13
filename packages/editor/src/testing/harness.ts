import { parseDocument, serializeDocument } from '@quill/markdown'
import { EditorState } from '@tiptap/pm/state'

import { documentFromMdast } from '../document/ast.ts'
import { editorSchema } from '../schema/editor-schema.ts'

import type { DocumentAst } from '../document-ast.ts'
import { createFakeClock } from '../drafts/clock.ts'
import type { FakeClock } from '../drafts/clock.ts'
import type {
  AcquireResult,
  DraftClient,
  DraftSaveResult,
  HeartbeatResult,
  LoadedDraft,
  LockClient,
  TakeoverResult,
} from '../drafts/clients.ts'
import { createMemoryRecoveryStore } from '../drafts/recovery-store.ts'
import type { RecoveryStore } from '../drafts/recovery-store.ts'

/**
 * Everything the web application needs to test a screen built on this editor,
 * without a server.
 *
 * The package asks for its clients rather than making requests, so a test can
 * supply them. These are those clients: scripted replies, a clock the test
 * advances by hand, and a recovery store it can read. A partition is `offline`,
 * which is the honest shape of one — the request never completes, rather than
 * returning a tidy error.
 */

export interface Replies<T> {
  /** Queue results for the next calls; when the queue runs dry the default returns. */
  push(...results: readonly T[]): void
  next(): T
}

function replies<T>(fallback: T): Replies<T> {
  const queued: T[] = []
  return {
    push(...results) {
      queued.push(...results)
    },
    next: () => queued.shift() ?? fallback,
  }
}

const LOCK = { holderUserId: 'author', holderSessionId: 'session', expiresAt: 60_000 }

export interface FakeLockClient extends LockClient {
  readonly calls: readonly string[]
  readonly acquires: Replies<AcquireResult>
  readonly heartbeats: Replies<HeartbeatResult>
  readonly takeovers: Replies<TakeoverResult>
  /** While true every call hangs forever, which is what a partition looks like. */
  offline: boolean
}

export interface FakeDraftClient extends DraftClient {
  readonly saves: readonly { readonly ast: DocumentAst; readonly expectedVersion: number }[]
  readonly loads: Replies<LoadedDraft>
  readonly results: Replies<DraftSaveResult>
  offline: boolean
}

function createFakeLockClient(): FakeLockClient {
  const calls: string[] = []
  const client: FakeLockClient = {
    calls,
    acquires: replies<AcquireResult>({ status: 'acquired', lock: LOCK }),
    heartbeats: replies<HeartbeatResult>({ status: 'alive', expiresAt: LOCK.expiresAt }),
    takeovers: replies<TakeoverResult>({ status: 'acquired', lock: LOCK }),
    offline: false,
    acquire: () => record('acquire', () => client.acquires.next()),
    heartbeat: () => record('heartbeat', () => client.heartbeats.next()),
    takeover: () => record('takeover', () => client.takeovers.next()),
    release: () => record('release', () => undefined),
  }
  function record<T>(name: string, reply: () => T): Promise<T> {
    calls.push(name)
    return client.offline ? new Promise<T>(() => {}) : Promise.resolve(reply())
  }
  return client
}

const EMPTY_DRAFT: LoadedDraft = {
  ast: { type: 'root', children: [] },
  draftVersion: 1,
  baseRevision: null,
}

function createFakeDraftClient(): FakeDraftClient {
  const saves: { ast: DocumentAst; expectedVersion: number }[] = []
  let version = EMPTY_DRAFT.draftVersion
  const client: FakeDraftClient = {
    saves,
    loads: replies<LoadedDraft>(EMPTY_DRAFT),
    results: replies<DraftSaveResult>({ status: 'saved', draftVersion: 0, updatedAt: 0 }),
    offline: false,
    load: () => (client.offline ? new Promise(() => {}) : Promise.resolve(client.loads.next())),
    save: (ast, expectedVersion) => {
      saves.push({ ast, expectedVersion })
      if (client.offline) return new Promise<DraftSaveResult>(() => {})
      const result = client.results.next()
      // The default reply acknowledges whatever it was given, so a test that
      // cares only about the lock does not have to script every save.
      if (result.status !== 'saved') return Promise.resolve(result)
      version = Math.max(version, expectedVersion) + 1
      return Promise.resolve({ status: 'saved', draftVersion: version, updatedAt: version })
    },
  }
  return client
}

export interface EditorTestHarness {
  readonly clock: FakeClock
  readonly lockClient: FakeLockClient
  readonly draftClient: FakeDraftClient
  readonly recoveryStore: RecoveryStore
  /** Markdown to the AST the editor opens. */
  open(markdown: string): DocumentAst
  /** The AST the editor gives back, as Markdown, for one readable assertion. */
  read(ast: DocumentAst): string
  /** A ProseMirror state over the editor's schema, for testing a command directly. */
  state(markdown: string): EditorState
}

export function createEditorTestHarness(): EditorTestHarness {
  return {
    clock: createFakeClock(),
    lockClient: createFakeLockClient(),
    draftClient: createFakeDraftClient(),
    recoveryStore: createMemoryRecoveryStore(),
    open: (markdown) => parseDocument(markdown).ast,
    read: (ast) => serializeDocument({ frontMatter: {}, ast }),
    state: (markdown) =>
      EditorState.create({
        schema: editorSchema,
        doc: documentFromMdast(parseDocument(markdown).ast).doc,
      }),
  }
}
