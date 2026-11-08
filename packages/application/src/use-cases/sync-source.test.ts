import { describe, expect, it, vi } from 'vitest'
import {
  documentId,
  sourcePatternMatcher,
  sourcePatternPrefix,
  unitId,
  workspaceId,
} from '@quill/domain'
import type { DocumentId, WorkspaceId } from '@quill/domain'

import { AUTHORED_AT_MAX_SKEW_MS } from '../ports/content-store.ts'
import type { ContentAuthor } from '../ports/content-store.ts'
import { ExternalSourceError } from '../ports/external-source.ts'
import type {
  ExternalSource,
  SourceChange,
  SourceFile,
  SourceFileContent,
  SourceRevision,
} from '../ports/external-source.ts'
import type { SourceSettings, SourceSyncLock } from '../ports/source-sync.ts'
import {
  aShortId,
  createFakeClock,
  createFakeContentStore,
  createFakeDocumentFormat,
  createFakeIdGenerator,
  createInMemoryUnitOfWork,
  serialise,
} from '../test-support/index.ts'
import type { FakeContentStore, InMemoryUnitOfWork } from '../test-support/index.ts'
import {
  COLLECTION_DELETED,
  DOCUMENT_MOVED,
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
  EVENT_PAYLOAD_VERSION,
  SOURCE_SYNC_REQUESTED,
} from './events.ts'
import {
  archivedPath,
  handleSourceSyncRequested,
  HISTORY_REWRITTEN_SUMMARY,
  importedAtSummary,
  LAYOUT_CHANGED_SUMMARY,
  requestSourceSync,
  syncSource,
} from './sync-source.ts'
import type { SyncSourceDependencies } from './sync-source.ts'

const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const NOW = new Date('2026-06-01T12:00:00.000Z')
const ADA: ContentAuthor = { name: 'Ada', email: 'ada@example.com' }
const GUIDES = 'collection-guides'
const DECISIONS = 'collection-decisions'

// ---------------------------------------------------------------------------
// A fake external source: a first-parent chain of snapshots
// ---------------------------------------------------------------------------

type FileSpec =
  | string
  | { readonly kind: 'symbolic-link'; readonly target: string }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }

interface Commit {
  readonly id: string
  readonly files: Readonly<Record<string, FileSpec>>
  /** Paths the source's rename detection pairs, old to new. */
  readonly renames?: Readonly<Record<string, string>>
  readonly subject?: string
  readonly committedAt?: Date
}

const encoder = new TextEncoder()

class FakeSource implements ExternalSource {
  chain: Commit[] = []
  fetches = 0
  fetchFailure: Error | null = null
  historyFailure: Error | null = null
  /** File ids `readFiles` pretends not to hold. */
  readonly missing = new Set<string>()

  constructor(commits: readonly Commit[] = []) {
    this.chain = [...commits]
  }

  push(commit: Commit): void {
    this.chain.push(commit)
  }

  async head(): Promise<string> {
    return this.chain.at(-1)?.id ?? 'empty'
  }

  async fetch(): Promise<string> {
    this.fetches += 1
    if (this.fetchFailure !== null) throw this.fetchFailure
    return await this.head()
  }

  /** What the source was narrowed to, each time. */
  readonly narrowed: (readonly string[])[] = []

  async narrow(paths: readonly string[]): Promise<void> {
    this.narrowed.push(paths)
  }

  /** Whether a path is under what the source was last narrowed to; everything before that. */
  #within(path: string): boolean {
    const paths = this.narrowed.at(-1)
    if (paths === undefined) return true
    return paths.some((pattern) => sourcePatternMatcher(sourcePatternPrefix(pattern))(path))
  }

  async *files(revision: string): AsyncIterable<SourceFile> {
    for (const [path, spec] of Object.entries(this.#commit(revision).files)) {
      if (this.#within(path)) yield toFile(path, spec)
    }
  }

  async file(revision: string, path: string): Promise<SourceFile | null> {
    // A source none of whose revisions exist yet has no files at its head.
    if (this.chain.length === 0) return null
    const spec = this.#commit(revision).files[path]
    return spec === undefined ? null : toFile(path, spec)
  }

  async *readFiles(fileIds: Iterable<string>): AsyncIterable<SourceFileContent> {
    for (const fileId of fileIds) {
      if (this.missing.has(fileId)) continue
      const spec: unknown = JSON.parse(fileId.slice(fileId.indexOf('#') + 1))
      if (typeof spec === 'string') yield { kind: 'content', fileId, bytes: encoder.encode(spec) }
      else if (isBytes(spec)) yield { kind: 'content', fileId, bytes: new Uint8Array(spec.bytes) }
      else if (isTooLarge(spec)) yield { kind: 'too-large', fileId, size: 1 << 30 }
      else throw new Error(`readFiles: ${fileId} is not a file`)
    }
  }

  async *history(since: string | null, until: string): AsyncIterable<SourceRevision> {
    if (this.historyFailure !== null) throw this.historyFailure
    const start = since === null ? 0 : this.chain.findIndex((commit) => commit.id === since) + 1
    if (start === 0 && since !== null) {
      throw new ExternalSourceError('history-rewritten', `${since} is not an ancestor`)
    }
    const end = this.chain.findIndex((commit) => commit.id === until)
    for (let index = start; index <= end; index++) {
      const commit = this.chain[index] as Commit
      const before = index === 0 ? {} : (this.chain[index - 1] as Commit).files
      if (JSON.stringify(before) !== JSON.stringify(commit.files)) yield toRevision(commit)
    }
  }

  async *changes(from: string | null, to: string): AsyncIterable<SourceChange> {
    // As a diff limited to the source's paths sees it: a rename across their
    // edge is a removal or an addition.
    for await (const change of this.#allChanges(from, to)) {
      if (change.kind === 'removed') {
        if (this.#within(change.path)) yield change
      } else if (change.kind !== 'renamed' || this.#within(change.fromPath)) {
        if (this.#within(change.file.path)) yield change
        else if (change.kind === 'renamed') yield { kind: 'removed', path: change.fromPath }
      } else if (this.#within(change.file.path)) {
        yield { kind: 'added', file: change.file }
      }
    }
  }

  async *#allChanges(from: string | null, to: string): AsyncIterable<SourceChange> {
    const before = from === null ? {} : this.#commit(from).files
    const after = this.#commit(to)
    const renames = after.renames ?? {}
    const renamedTo = new Set(Object.values(renames))
    for (const [fromPath, toPath] of Object.entries(renames)) {
      yield { kind: 'renamed', fromPath, file: toFile(toPath, after.files[toPath] as FileSpec) }
    }
    for (const [path, spec] of Object.entries(after.files)) {
      if (renamedTo.has(path)) continue
      if (!(path in before)) yield { kind: 'added', file: toFile(path, spec) }
      else if (JSON.stringify(before[path]) !== JSON.stringify(spec)) {
        yield { kind: 'modified', file: toFile(path, spec) }
      }
    }
    for (const path of Object.keys(before)) {
      if (!(path in after.files) && !(path in renames)) yield { kind: 'removed', path }
    }
  }

  #commit(id: string): Commit {
    const commit = this.chain.find((candidate) => candidate.id === id)
    if (commit === undefined) throw new ExternalSourceError('unknown-revision', id)
    return commit
  }
}

function isBytes(spec: unknown): spec is { kind: 'bytes'; bytes: number[] } {
  return typeof spec === 'object' && spec !== null && (spec as { kind?: unknown }).kind === 'bytes'
}

function isTooLarge(spec: unknown): boolean {
  return (
    typeof spec === 'object' && spec !== null && (spec as { kind?: unknown }).kind === 'too-large'
  )
}

/** Content-addressed, so equal contents share an id, as a real source's do. */
function toFile(path: string, spec: FileSpec): SourceFile {
  const serialisable =
    typeof spec === 'object' && spec.kind === 'bytes'
      ? { kind: 'bytes', bytes: [...spec.bytes] }
      : spec
  const fileId = `${path}#${JSON.stringify(serialisable)}`
  const kind = typeof spec === 'object' && spec.kind === 'symbolic-link' ? 'symbolic-link' : 'file'
  return { path, fileId, kind }
}

let tick = 0
function toRevision(commit: Commit): SourceRevision {
  tick += 1
  const committedAt = commit.committedAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, tick))
  return {
    id: commit.id,
    author: ADA,
    authoredAt: committedAt,
    committedAt,
    subject: commit.subject ?? `Change ${commit.id}`,
  }
}

function inMemoryLock(): SourceSyncLock & { readonly held: Set<WorkspaceId> } {
  const held = new Set<WorkspaceId>()
  return {
    held,
    async withLock(id, work) {
      if (held.has(id)) return { kind: 'busy' }
      held.add(id)
      try {
        return { kind: 'ran', value: await work() }
      } finally {
        held.delete(id)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  readonly deps: SyncSourceDependencies
  readonly uow: InMemoryUnitOfWork
  readonly store: FakeContentStore
  readonly source: FakeSource
  readonly lock: ReturnType<typeof inMemoryLock>
  readonly clock: ReturnType<typeof createFakeClock>
  sync(): ReturnType<typeof syncSource>
  /** Changes the source's stored settings, as an administrator would. */
  configure(settings: Partial<SourceSettings>): void
  idAt(path: string): Promise<DocumentId>
  stored(path: string): Promise<string | undefined>
}

function harness(
  commits: readonly Commit[],
  settings: Partial<SourceSettings> = {},
  overrides: Partial<SyncSourceDependencies> = {},
): Harness {
  const uow = createInMemoryUnitOfWork()
  const clock = createFakeClock(NOW)
  const store = createFakeContentStore({ now: () => clock.now() })
  const source = new FakeSource(commits)
  const lock = inMemoryLock()
  let resolved: SourceSettings = {
    collections: [
      { collectionId: GUIDES, path: 'docs' },
      { collectionId: DECISIONS, path: 'docs/adr/' },
    ],
    history: 'full',
    commitMessages: 'subject',
    ...settings,
  }
  const deps: SyncSourceDependencies = {
    uow,
    contentStore: store,
    format: createFakeDocumentFormat(),
    sources: {
      forWorkspace: async (id) => (id === WORKSPACE ? { source, settings: resolved } : null),
    },
    lock,
    clock,
    ids: createFakeIdGenerator('aaaa'),
    ...overrides,
  }
  const idAt = async (path: string): Promise<DocumentId> => {
    const rows = await uow.repos.sourcePaths.listByWorkspace(WORKSPACE)
    const row = rows.find((candidate) => candidate.path === path)
    if (row === undefined) throw new Error(`no path map entry for ${path}`)
    return row.documentId
  }
  return {
    deps,
    uow,
    store,
    source,
    lock,
    clock,
    sync: () => syncSource(deps, { workspaceId: WORKSPACE }),
    configure: (changed) => {
      resolved = { ...resolved, ...changed }
    },
    idAt,
    stored: async (path) => {
      const tree = await store.listTree(WORKSPACE)
      const entry = tree.find((candidate) => candidate.path === path)
      if (entry?.documentId === undefined) return undefined
      return (await store.read(WORKSPACE, entry.documentId))?.markdown
    },
  }
}

const state = (h: Harness) => h.uow.repos.sourceSyncState.find(WORKSPACE)

// ---------------------------------------------------------------------------

describe('syncSource', () => {
  it('does nothing for a workspace that reads from no source', async () => {
    const h = harness([])
    expect(
      await syncSource(h.deps, {
        workspaceId: workspaceId('00000000-0000-4000-8000-000000000909'),
      }),
    ).toEqual({
      kind: 'not-sourced',
    })
  })

  it('leaves a source alone while another sync of it holds the lock', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a.md': '# A' } }])
    h.lock.held.add(WORKSPACE)
    expect(await h.sync()).toEqual({ kind: 'busy' })
    expect(h.source.fetches).toBe(0)
  })

  describe('a first sync', () => {
    it('replays every revision oldest first, each as one publish authored by its author', async () => {
      const second = new Date('2026-02-01T00:00:00.000Z')
      const h = harness([
        {
          id: 'c1',
          files: { 'docs/setup.md': '# Setting up\n\nRun it.', 'docs/adr/0001-auth.md': 'Body' },
          subject: 'Add the guides',
        },
        {
          id: 'c2',
          files: {
            'docs/setup.md': '# Setting up\n\nRun it twice.',
            'docs/adr/0001-auth.md': 'Body',
          },
          committedAt: second,
        },
      ])

      expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c2', published: 2 })

      expect(h.store.requests.map((request) => request.sourceRevision)).toEqual(['c1', 'c2'])
      const [first, latest] = h.store.requests
      expect(first?.author).toEqual(ADA)
      expect(first?.changeNote).toBe('Add the guides')
      expect(first?.base).toBeNull()
      expect(latest?.authoredAt).toEqual(second)
      expect(latest?.base).toBe(
        (await h.uow.repos.revisions.findBySourceRevision(WORKSPACE, 'c1'))?.revision,
      )
      expect(latest?.changes.map((change) => change.kind)).toEqual(['write'])
    })

    it('mints an id at first sight and writes it into the stored copy only', async () => {
      const h = harness([
        {
          id: 'c1',
          files: { 'docs/setup.md': serialise({ id: 'copied', title: 'Setup' }, 'Body') },
        },
      ])
      await h.sync()

      const id = await h.idAt('docs/setup.md')
      expect(await h.stored('docs/setup.md')).toBe(serialise({ id, title: 'Setup' }, 'Body'))
      const row = await h.uow.repos.documents.findById(id)
      expect(row).toMatchObject({
        workspaceId: WORKSPACE,
        collectionId: GUIDES,
        parentId: null,
        path: 'docs/setup.md',
        title: 'Setup',
        slug: 'setup',
        status: 'published',
        createdBy: null,
        headRevision: await h.store.head(WORKSPACE),
      })
    })

    it('names a document by its first heading, and else by its file or folder', async () => {
      const h = harness([
        {
          id: 'c1',
          files: {
            'docs/heading.md': '# From the heading',
            'docs/getting_started-guide.md': 'No heading',
            'docs/tools/README.md': 'No heading',
          },
        },
      ])
      await h.sync()
      const title = async (path: string) =>
        (await h.uow.repos.documents.findById(await h.idAt(path)))?.title
      expect(await title('docs/heading.md')).toBe('From the heading')
      expect(await title('docs/getting_started-guide.md')).toBe('Getting started guide')
      expect(await title('docs/tools/README.md')).toBe('Tools')
    })

    it('places each file in the collection with the longest path it lies under', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A', 'docs/adr/b.md': 'B' } }])
      await h.sync()
      const collection = async (path: string) =>
        (await h.uow.repos.documents.findById(await h.idAt(path)))?.collectionId
      expect(await collection('docs/a.md')).toBe(GUIDES)
      expect(await collection('docs/adr/b.md')).toBe(DECISIONS)
    })

    it('records each revision in the index under its source revision, published by nobody', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': '# A' }, subject: 'Write A' }])
      await h.sync()
      const id = await h.idAt('docs/a.md')
      const row = await h.uow.repos.revisions.findBySourceRevision(WORKSPACE, 'c1')
      expect(row).toMatchObject({
        documentId: id,
        authorName: 'Ada',
        authorEmail: 'ada@example.com',
        authorUserId: null,
        summary: 'A',
        changeNote: 'Write A',
        sourceRevision: 'c1',
      })
      expect(
        h.uow.events
          .filter((event) => event.type === DOCUMENT_PUBLISHED)
          .map((event) => event.payload),
      ).toEqual([
        {
          version: EVENT_PAYLOAD_VERSION,
          documentId: id,
          workspaceId: WORKSPACE,
          revision: row?.revision,
          publishedBy: null,
        },
      ])
      expect(await state(h)).toMatchObject({
        lastSyncedRevision: 'c1',
        lastSyncedAt: NOW,
        lastAttemptAt: NOW,
        failure: null,
        refused: [],
      })
    })

    it('imports only the head as one revision when the source asks for no history', async () => {
      const h = harness(
        [
          { id: 'c1', files: { 'docs/a.md': 'A' } },
          { id: 'c2', files: { 'docs/a.md': 'A2', 'docs/b.md': 'B' } },
        ],
        { history: 'head' },
      )
      expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c2', published: 1 })
      expect(h.store.requests).toHaveLength(1)
      expect(h.store.requests[0]).toMatchObject({
        sourceRevision: 'c2',
        changeNote: importedAtSummary('c2'),
      })
    })

    it('publishes nothing for a source none of whose revisions changed its paths', async () => {
      const h = harness([], { history: 'head' })
      h.source.chain = []
      expect(await h.sync()).toEqual({ kind: 'synced', revision: 'empty', published: 0 })
    })
  })

  it('does nothing when the remote head is the revision it last synced', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }])
    await h.sync()
    expect(await h.sync()).toEqual({ kind: 'up-to-date', revision: 'c1' })
    expect(h.source.fetches).toBe(1)
  })

  it('shows no message when the source keeps commit messages to itself', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }], { commitMessages: 'none' })
    await h.sync()
    expect(h.store.requests[0]).not.toHaveProperty('changeNote')
  })

  it('shows no message for a revision with an empty subject', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' }, subject: '' }])
    await h.sync()
    expect(h.store.requests[0]).not.toHaveProperty('changeNote')
    expect(
      (await h.uow.repos.revisions.findBySourceRevision(WORKSPACE, 'c1'))?.changeNote,
    ).toBeNull()
  })

  describe('a later sync', () => {
    it("keeps a renamed file's id, and moves it in the store, the tree and the path map", async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': '# Alpha' } }])
      await h.sync()
      const id = await h.idAt('docs/a.md')
      h.source.push({
        id: 'c2',
        files: { 'docs/adr/b.md': '# Beta' },
        renames: { 'docs/a.md': 'docs/adr/b.md' },
      })

      expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c2', published: 1 })

      expect(h.store.requests[1]?.changes).toEqual([
        {
          kind: 'move',
          documentId: id,
          fromPath: 'docs/a.md',
          toPath: 'docs/adr/b.md',
          markdown: serialise({ id }, '# Beta'),
        },
      ])
      expect(await h.idAt('docs/adr/b.md')).toBe(id)
      await expect(h.idAt('docs/a.md')).rejects.toThrow('no path map entry for docs/a.md')
      expect(await h.uow.repos.documents.findById(id)).toMatchObject({
        path: 'docs/adr/b.md',
        title: 'Beta',
        collectionId: DECISIONS,
      })
      const types = h.uow.events.map((event) => event.type)
      expect(types).toContain(DOCUMENT_RENAMED)
      expect(types).toContain(DOCUMENT_MOVED)
    })

    it('records an edit that keeps the title and the collection without renaming or moving', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': '# A\n\none' } }])
      await h.sync()
      h.source.push({ id: 'c2', files: { 'docs/a.md': '# A\n\ntwo' } })
      await h.sync()
      const types = h.uow.events.map((event) => event.type)
      expect(types).not.toContain(DOCUMENT_RENAMED)
      expect(types).not.toContain(DOCUMENT_MOVED)
      expect(await h.stored('docs/a.md')).toBe(
        serialise({ id: await h.idAt('docs/a.md') }, '# A\n\ntwo'),
      )
    })

    it('archives a removed file, and gives it the same id when its path comes back', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A', 'docs/b.md': 'B' } }])
      await h.sync()
      const id = await h.idAt('docs/a.md')

      h.source.push({ id: 'c2', files: { 'docs/b.md': 'B' } })
      await h.sync()
      expect(h.store.requests[1]?.changes).toEqual([
        { kind: 'delete', documentId: id, path: 'docs/a.md' },
      ])
      expect(await h.stored('docs/a.md')).toBeUndefined()
      expect((await h.uow.repos.documents.findById(id))?.status).toBe('archived')
      const rows = await h.uow.repos.sourcePaths.listByWorkspace(WORKSPACE)
      expect(rows.find((row) => row.path === 'docs/a.md')?.archivedAt).toEqual(NOW)
      expect((await h.uow.repos.revisions.findBySourceRevision(WORKSPACE, 'c2'))?.summary).toBe('A')

      h.source.push({ id: 'c3', files: { 'docs/a.md': 'A again', 'docs/b.md': 'B' } })
      await h.sync()
      expect(await h.idAt('docs/a.md')).toBe(id)
      expect((await h.uow.repos.documents.findById(id))?.status).toBe('published')
      expect(await h.stored('docs/a.md')).toBe(serialise({ id }, 'A again'))
    })

    it('gives the path of an archived document to a file renamed onto it', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A', 'docs/b.md': 'B' } }])
      await h.sync()
      const archived = await h.idAt('docs/a.md')
      const moving = await h.idAt('docs/b.md')
      h.source.push({ id: 'c2', files: { 'docs/b.md': 'B' } })
      await h.sync()
      h.source.push({
        id: 'c3',
        files: { 'docs/a.md': 'B' },
        renames: { 'docs/b.md': 'docs/a.md' },
      })
      await h.sync()

      expect(await h.idAt('docs/a.md')).toBe(moving)
      expect((await h.uow.repos.documents.findById(archived))?.path).toBe(archivedPath(archived))
      expect((await h.uow.repos.documents.findById(moving))?.path).toBe('docs/a.md')
    })

    it('frees a path a rename leaves for a file added there in the same revision', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'Old A' } }])
      await h.sync()
      const moved = await h.idAt('docs/a.md')
      h.source.push({
        id: 'c2',
        files: { 'docs/b.md': 'Old A', 'docs/a.md': 'New A' },
        renames: { 'docs/a.md': 'docs/b.md' },
      })
      await h.sync()
      const added = await h.idAt('docs/a.md')
      expect(added).not.toBe(moved)
      expect(await h.idAt('docs/b.md')).toBe(moved)
      expect((await h.uow.repos.documents.findById(moved))?.path).toBe('docs/b.md')
      expect(h.store.requests[1]?.changes.map((change) => change.kind)).toEqual(['move', 'write'])
    })

    it('archives a document renamed to a file that is not one, and adds one renamed from such a file', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A', 'docs/notes.txt': 'N' } }])
      await h.sync()
      const id = await h.idAt('docs/a.md')
      h.source.push({
        id: 'c2',
        files: { 'docs/a.txt': 'A', 'docs/notes.md': 'N' },
        renames: { 'docs/a.md': 'docs/a.txt', 'docs/notes.txt': 'docs/notes.md' },
      })
      await h.sync()
      expect(h.store.requests[1]?.changes).toEqual([
        { kind: 'delete', documentId: id, path: 'docs/a.md' },
        {
          kind: 'write',
          documentId: await h.idAt('docs/notes.md'),
          path: 'docs/notes.md',
          markdown: serialise({ id: await h.idAt('docs/notes.md') }, 'N'),
        },
      ])
    })

    it('records a revision that changes no document as synced without publishing', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }])
      await h.sync()
      h.source.push({ id: 'c2', files: { 'docs/a.md': 'A', 'docs/diagram.svg': '<svg/>' } })
      h.source.push({ id: 'c3', files: { 'docs/a.md': 'A' } })
      expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c3', published: 0 })
      expect((await state(h))?.lastSyncedRevision).toBe('c3')
    })
  })

  describe('files it cannot store', () => {
    it('lists them with the revision and the reason, and keeps the rest', async () => {
      const h = harness([
        {
          id: 'c1',
          files: {
            'docs/ok.md': 'Fine',
            'docs/link.md': { kind: 'symbolic-link', target: '../../etc/passwd' },
            'docs/huge.md': { kind: 'too-large' },
            'docs/latin1.md': { kind: 'bytes', bytes: new Uint8Array([0xff, 0xfe, 0x41]) },
            'elsewhere/x.md': 'Outside',
          },
        },
      ])
      await h.sync()
      expect(h.store.requests[0]?.changes.map((change) => 'path' in change && change.path)).toEqual(
        ['docs/ok.md'],
      )
      expect((await state(h))?.refused).toEqual(
        expect.arrayContaining([
          { path: 'docs/link.md', revision: 'c1', reason: 'symbolic-link' },
          { path: 'docs/huge.md', revision: 'c1', reason: 'too-large' },
          { path: 'docs/latin1.md', revision: 'c1', reason: 'not-utf8' },
        ]),
      )
      // A file no collection reads is left out, not refused.
      expect((await state(h))?.refused.map(({ path }) => path)).not.toContain('elsewhere/x.md')
    })

    it('drops a file from the list once a revision stores or removes it', async () => {
      const h = harness([
        {
          id: 'c1',
          files: {
            'docs/huge.md': { kind: 'too-large' },
            'docs/link.md': { kind: 'symbolic-link', target: 'x' },
          },
        },
      ])
      await h.sync()
      h.source.push({ id: 'c2', files: { 'docs/huge.md': 'Smaller now' } })
      await h.sync()
      expect((await state(h))?.refused).toEqual([])
      expect(await h.stored('docs/huge.md')).toBe(
        serialise({ id: await h.idAt('docs/huge.md') }, 'Smaller now'),
      )
    })

    it('archives a document renamed into a file it cannot store', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A', 'docs/b.md': 'B' } }])
      await h.sync()
      const a = await h.idAt('docs/a.md')
      const b = await h.idAt('docs/b.md')
      h.source.push({
        id: 'c2',
        files: { 'docs/huge.md': { kind: 'too-large' }, 'outside/b.md': 'B' },
        renames: { 'docs/a.md': 'docs/huge.md', 'docs/b.md': 'outside/b.md' },
      })
      await h.sync()
      expect(h.store.requests[1]?.changes).toEqual([
        { kind: 'delete', documentId: b, path: 'docs/b.md' },
        { kind: 'delete', documentId: a, path: 'docs/a.md' },
      ])
    })

    it('adds a file renamed from one it never stored', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/huge.md': { kind: 'too-large' } } }])
      await h.sync()
      h.source.push({
        id: 'c2',
        files: { 'docs/small.md': 'S' },
        renames: { 'docs/huge.md': 'docs/small.md' },
      })
      await h.sync()
      expect(h.store.requests[0]?.changes[0]).toMatchObject({
        kind: 'write',
        path: 'docs/small.md',
      })
      expect((await state(h))?.refused).toEqual([])
    })

    it('stops at a file the source did not return, rather than storing a gap', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }])
      h.source.missing.add('docs/a.md#"A"')
      expect(await h.sync()).toMatchObject({
        kind: 'failed',
        failure: { reason: 'file-missing', revision: 'c1' },
      })
    })
  })

  it('skips a revision the index already holds, so an interrupted replay resumes', async () => {
    const h = harness([
      { id: 'c1', files: { 'docs/a.md': 'A' } },
      { id: 'c2', files: { 'docs/a.md': 'A2' } },
    ])
    await h.uow.repos.revisions.append({
      id: 'recorded',
      documentId: documentId('00000000-0000-4000-8000-000000000999'),
      workspaceId: WORKSPACE,
      revision: 'r' as never,
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      timestamp: NOW,
      summary: 'A',
      changeNote: null,
      sourceRevision: 'c1',
      now: NOW,
    })
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c2', published: 1 })
    expect(h.store.requests.map((request) => request.sourceRevision)).toEqual(['c2'])
  })

  it('publishes a rewritten branch as one revision of the difference', async () => {
    const h = harness([
      { id: 'c1', files: { 'docs/a.md': 'A', 'docs/b.md': 'B' } },
      { id: 'c2', files: { 'docs/a.md': 'A', 'docs/b.md': 'B', 'docs/gone.md': 'G' } },
    ])
    await h.sync()
    const a = await h.idAt('docs/a.md')
    const gone = await h.idAt('docs/gone.md')
    h.source.chain = [
      { id: 'n1', files: { 'docs/a.md': 'A rewritten', 'docs/b.md': 'B' } },
      { id: 'n2', files: { 'docs/a.md': 'A rewritten', 'docs/b.md': 'B' } },
    ]
    await h.uow.repos.sourcePaths.put(
      {
        workspaceId: WORKSPACE,
        path: 'docs/ghost.md',
        documentId: documentId('00000000-0000-4000-8000-00000000aaaa'),
        archivedAt: NOW,
        order: null,
      },
      NOW,
    )

    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'n2', published: 1 })

    const request = h.store.requests.at(-1)
    expect(request).toMatchObject({ sourceRevision: 'n1', changeNote: HISTORY_REWRITTEN_SUMMARY })
    expect(request?.changes).toEqual(
      expect.arrayContaining([
        { kind: 'delete', documentId: gone, path: 'docs/gone.md' },
        {
          kind: 'write',
          documentId: a,
          path: 'docs/a.md',
          markdown: serialise({ id: a }, 'A rewritten'),
        },
      ]),
    )
    expect(await h.idAt('docs/a.md')).toBe(a)
  })

  it('stamps a revision dated in our future with our time', async () => {
    const future = new Date(NOW.getTime() + AUTHORED_AT_MAX_SKEW_MS + 1)
    const near = new Date(NOW.getTime() + AUTHORED_AT_MAX_SKEW_MS)
    const h = harness([
      { id: 'c1', files: { 'docs/a.md': 'A' }, committedAt: future },
      { id: 'c2', files: { 'docs/a.md': 'B' }, committedAt: near },
    ])
    await h.sync()
    expect(h.store.requests.map((request) => request.authoredAt)).toEqual([NOW, near])
    expect((await h.uow.repos.revisions.findBySourceRevision(WORKSPACE, 'c1'))?.timestamp).toEqual(
      NOW,
    )
  })

  describe('a failed sync', () => {
    it('records a fetch failure and keeps what was synced', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }])
      await h.sync()
      h.source.push({ id: 'c2', files: { 'docs/a.md': 'B' } })
      h.source.fetchFailure = new ExternalSourceError('timeout', 'The fetch took too long')
      h.clock.advance(60_000)

      expect(await h.sync()).toEqual({
        kind: 'failed',
        failure: { reason: 'timeout', message: 'The fetch took too long', revision: null },
      })
      expect(await state(h)).toMatchObject({
        lastSyncedRevision: 'c1',
        lastSyncedAt: NOW,
        lastAttemptAt: new Date(NOW.getTime() + 60_000),
        failure: { reason: 'timeout' },
      })
      expect(await h.stored('docs/a.md')).toBe(serialise({ id: await h.idAt('docs/a.md') }, 'A'))
    })

    it('records a failure before any sync as nothing synced', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }])
      h.source.historyFailure = new ExternalSourceError('command-failed', 'git log failed')
      expect(await h.sync()).toMatchObject({
        kind: 'failed',
        failure: { reason: 'command-failed' },
      })
      expect(await state(h)).toMatchObject({
        lastSyncedRevision: null,
        lastSyncedAt: null,
        refused: [],
      })
    })

    it('stops at a revision whose id the store cannot record, naming it', async () => {
      const h = harness([
        { id: 'c1', files: { 'docs/a.md': 'A' } },
        { id: 'bad id', files: { 'docs/a.md': 'B' } },
      ])
      expect(await h.sync()).toMatchObject({
        kind: 'failed',
        failure: { reason: 'store-refused', revision: 'bad id' },
      })
      expect((await state(h))?.lastSyncedRevision).toBe('c1')
    })

    it('stops when something else wrote the workspace meanwhile', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }])
      vi.spyOn(h.store, 'publish').mockResolvedValue({
        kind: 'merge-required',
        current: 'x' as never,
        conflicts: [],
      })
      expect(await h.sync()).toMatchObject({
        kind: 'failed',
        failure: { reason: 'store-moved', revision: 'c1' },
      })
    })

    it('records and rethrows a failure it did not foresee, for the outbox to retry', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }])
      vi.spyOn(h.store, 'publish').mockRejectedValueOnce(new Error('disk full'))
      await expect(h.sync()).rejects.toThrow('disk full')
      expect((await state(h))?.failure).toEqual({
        reason: 'unexpected',
        message: 'disk full',
        revision: 'c1',
      })

      vi.spyOn(h.store, 'head').mockRejectedValueOnce('no head')
      await expect(h.sync()).rejects.toBe('no head')
      expect((await state(h))?.failure?.message).toBe('no head')
    })

    it('stops when another document holds a path it is placing', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }])
      await h.uow.repos.documents.create({
        ...someDocument(),
        path: 'docs/a.md',
        shortId: aShortId(90),
      })
      await expect(h.sync()).rejects.toThrow('Another document already holds docs/a.md')
    })

    it('stops when no short key is free', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }])
      for (let seed = 1; seed <= 5; seed++) {
        await h.uow.repos.documents.create({ ...someDocument(seed), shortId: aShortId(seed) })
      }
      await expect(h.sync()).rejects.toThrow('No free short key')
    })
  })
})

function someDocument(seed = 0) {
  return {
    id: documentId(`00000000-0000-4000-8000-0000000007${seed.toString().padStart(2, '0')}`),
    workspaceId: WORKSPACE,
    collectionId: GUIDES,
    parentId: null,
    slug: `other-${seed}`,
    path: `other/${seed}.md`,
    title: 'Other',
    status: 'published' as const,
    templateId: null,
    templateVersion: null,
    now: NOW,
  }
}

// ---------------------------------------------------------------------------
// The manifest and the tree
// ---------------------------------------------------------------------------

const MANIFEST = '.quill/workspace.yaml'

function manifest(...collections: string[]): string {
  return ['version: 1', 'collections:', ...collections.map((line) => `  - ${line}`)].join('\n')
}

const GUIDES_AT_DOCS = '{ slug: guides, title: Guides, path: docs/guides }'

async function collectionsOf(h: Harness) {
  return await h.uow.repos.collections.listByWorkspace(WORKSPACE)
}

async function documentAt(h: Harness, path: string) {
  const row = await h.uow.repos.documents.findById(await h.idAt(path))
  if (row === null) throw new Error(`no document at ${path}`)
  return row
}

describe('syncSource with a manifest', () => {
  it('creates its collections by slug, places files in them, and narrows the source to them', async () => {
    const h = harness([
      {
        id: 'c1',
        files: {
          [MANIFEST]: manifest(
            GUIDES_AT_DOCS,
            '{ slug: decisions, title: Decisions, path: docs/adr, order: filename }',
          ),
          'docs/guides/setup.md': '# Setup',
          'docs/adr/0001-auth.md': '# Auth',
          'docs/other.md': '# Other',
        },
      },
    ])
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c1', published: 1 })

    const collections = await collectionsOf(h)
    expect(collections.map(({ slug, name }) => [slug, name]).toSorted()).toEqual([
      ['decisions', 'Decisions'],
      ['guides', 'Guides'],
    ])
    const bySlug = new Map(collections.map((row) => [row.slug, row.id]))
    expect((await documentAt(h, 'docs/guides/setup.md')).collectionId).toBe(bySlug.get('guides'))
    expect((await documentAt(h, 'docs/adr/0001-auth.md')).collectionId).toBe(
      bySlug.get('decisions'),
    )
    await expect(h.idAt('docs/other.md')).rejects.toThrow('no path map entry')
    expect(h.source.narrowed).toEqual([[MANIFEST, 'docs/guides', 'docs/adr']])
    expect((await state(h))?.layout).toMatchObject({
      origin: 'manifest',
      collectionIds: expect.arrayContaining([bySlug.get('guides'), bySlug.get('decisions')]),
      unknownKeys: [],
    })
  })

  it('adopts a collection by its slug, retitled as the manifest says, and records keys it does not read', async () => {
    const h = harness(
      [
        {
          id: 'c1',
          files: {
            [MANIFEST]: `${manifest('{ slug: guides, title: How-to guides, path: docs }')}\nowner: docs-team`,
            'docs/a.md': '# A',
          },
        },
      ],
      { collections: [{ collectionId: GUIDES, path: 'docs' }] },
    )
    await h.uow.repos.collections.create({
      id: GUIDES,
      workspaceId: WORKSPACE,
      name: 'Guides',
      slug: 'guides',
      now: NOW,
    })
    await h.sync()
    expect(await collectionsOf(h)).toEqual([
      expect.objectContaining({ id: GUIDES, name: 'How-to guides' }),
    ])
    expect((await documentAt(h, 'docs/a.md')).collectionId).toBe(GUIDES)
    expect((await state(h))?.layout?.unknownKeys).toEqual([{ key: 'owner', line: 4 }])
  })

  it('reads the entry for its own workspace from a manifest of several', async () => {
    const h = harness([
      {
        id: 'c1',
        files: {
          [MANIFEST]: [
            'version: 1',
            'workspaces:',
            '  - { slug: internal, collections: [{ slug: all, title: All, path: docs }] }',
            '  - { slug: handbook, collections: [{ slug: public, title: Public, path: docs/public }] }',
          ].join('\n'),
          'docs/public/a.md': '# A',
          'docs/private/b.md': '# B',
        },
      },
    ])
    await h.uow.repos.workspaces.create({
      id: WORKSPACE,
      unitId: unitId('00000000-0000-4000-8000-000000000001'),
      name: 'Handbook',
      slug: 'handbook',
      now: NOW,
    })
    await h.sync()
    expect((await collectionsOf(h)).map(({ slug }) => slug)).toEqual(['public'])
    await expect(h.idAt('docs/private/b.md')).rejects.toThrow('no path map entry')
  })

  it('reads a glob, and leaves out what the manifest excludes', async () => {
    const h = harness([
      {
        id: 'c1',
        files: {
          [MANIFEST]: [
            manifest(
              '{ slug: packages, title: Packages, path: "packages/**/README.md" }',
              GUIDES_AT_DOCS,
            ),
            'exclude: [docs/guides/drafts]',
          ].join('\n'),
          'packages/ui/README.md': '# UI',
          'packages/ui/notes.md': '# Notes',
          'docs/guides/a.md': '# A',
          'docs/guides/drafts/b.md': '# B',
        },
      },
    ])
    await h.sync()
    const paths = await h.uow.repos.sourcePaths.listByWorkspace(WORKSPACE)
    expect(paths.map(({ path }) => path).toSorted()).toEqual([
      'docs/guides/a.md',
      'packages/ui/README.md',
    ])
  })

  it('re-plans the whole tree when the manifest changes: adds, moves and retires', async () => {
    const h = harness([
      {
        id: 'c1',
        files: {
          [MANIFEST]: manifest(
            '{ slug: guides, title: Guides, path: docs/guides }',
            '{ slug: notes, title: Notes, path: docs/notes }',
          ),
          'docs/guides/a.md': '# A',
          'docs/notes/n.md': '# N',
          'docs/extra/x.md': '# X',
        },
      },
    ])
    await h.sync()
    const notes = (await collectionsOf(h)).find(({ slug }) => slug === 'notes')
    const a = await h.idAt('docs/guides/a.md')
    const n = await h.idAt('docs/notes/n.md')

    // Only the manifest changes: the guides now read all of docs, and the notes go.
    h.source.push({
      id: 'c2',
      files: {
        [MANIFEST]: manifest('{ slug: guides, title: Guides, path: docs, order: oldest }'),
        'docs/guides/a.md': '# A',
        'docs/notes/n.md': '# N',
        'docs/extra/x.md': '# X',
      },
    })
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c2', published: 1 })

    const collections = await collectionsOf(h)
    expect(collections.map(({ slug }) => slug)).toEqual(['guides'])
    expect(h.uow.events.map((event) => event.type)).toContain(COLLECTION_DELETED)
    expect(h.store.requests[1]?.changes).toEqual([
      expect.objectContaining({ kind: 'write', path: 'docs/extra/x.md' }),
    ])
    expect(await h.idAt('docs/guides/a.md')).toBe(a)
    // The notes' document is placed again among the guides: same file, same id.
    expect(await h.idAt('docs/notes/n.md')).toBe(n)
    for (const path of ['docs/guides/a.md', 'docs/notes/n.md', 'docs/extra/x.md']) {
      expect((await documentAt(h, path)).collectionId).toBe(collections[0]?.id)
    }
    expect(await h.uow.repos.collections.findById(notes?.id ?? '')).toBeNull()
  })

  it('archives a document the manifest newly excludes, and goes back to the settings without it', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a.md': '# A', 'docs/drafts/b.md': '# B' } }], {
      collections: [{ collectionId: GUIDES, path: 'docs' }],
    })
    await h.sync()
    const b = await h.idAt('docs/drafts/b.md')
    h.source.push({
      id: 'c2',
      files: {
        [MANIFEST]: `${manifest('{ slug: docs, title: Docs, path: docs }')}\nexclude: [docs/drafts]`,
        'docs/a.md': '# A',
        'docs/drafts/b.md': '# B',
      },
    })
    await h.sync()
    expect((await h.uow.repos.documents.findById(b))?.status).toBe('archived')
    expect(h.store.requests[1]?.changes).toEqual([
      { kind: 'delete', documentId: b, path: 'docs/drafts/b.md' },
    ])
    const docs = (await collectionsOf(h)).find(({ slug }) => slug === 'docs')
    expect((await documentAt(h, 'docs/a.md')).collectionId).toBe(docs?.id)
    expect(h.uow.events.map((event) => event.type)).toContain(DOCUMENT_MOVED)
    expect((await state(h))?.layout?.origin).toBe('manifest')

    // The manifest goes: the settings place the tree again, and its collection retires.
    h.source.push({ id: 'c3', files: { 'docs/a.md': '# A', 'docs/drafts/b.md': '# B' } })
    await h.sync()
    expect((await documentAt(h, 'docs/a.md')).collectionId).toBe(GUIDES)
    expect(await h.idAt('docs/drafts/b.md')).toBe(b)
    expect((await h.uow.repos.documents.findById(b))?.status).toBe('published')
    expect(await h.uow.repos.collections.findById(docs?.id ?? '')).toBeNull()
    expect((await state(h))?.layout).toMatchObject({ origin: 'settings', collectionIds: [] })
  })

  it("gives a removed file's id to the file the manifest redirects it to", async () => {
    const redirects =
      'redirects: { docs/guides/old.md: docs/guides/new.md, docs/guides/other.md: docs/guides/new.md }'
    const h = harness([
      {
        id: 'c1',
        files: { [MANIFEST]: manifest(GUIDES_AT_DOCS), 'docs/guides/old.md': '# Old' },
      },
    ])
    await h.sync()
    const id = await h.idAt('docs/guides/old.md')
    h.source.push({
      id: 'c2',
      files: {
        [MANIFEST]: `${manifest(GUIDES_AT_DOCS)}\n${redirects}`,
        'docs/guides/new.md': '# Completely rewritten',
        'docs/guides/unrelated.md': '# Unrelated',
      },
    })
    await h.sync()
    expect(await h.idAt('docs/guides/new.md')).toBe(id)
    expect(h.store.requests[1]?.changes).toEqual([
      expect.objectContaining({
        kind: 'move',
        fromPath: 'docs/guides/old.md',
        toPath: 'docs/guides/new.md',
      }),
      expect.objectContaining({ kind: 'write', path: 'docs/guides/unrelated.md' }),
    ])
  })

  it('orders each collection: front matter order first, then the rule, as sort keys', async () => {
    const h = harness([
      {
        id: 'c1',
        files: {
          [MANIFEST]: manifest(GUIDES_AT_DOCS),
          'docs/guides/zebra.md': '# Zebra',
          'docs/guides/apple.md': '# Apple',
          'docs/guides/intro.md': serialise({ order: 1 }, '# Introduction'),
        },
      },
    ])
    await h.sync()
    const keys = async (): Promise<Record<string, number | null>> => {
      const rows = await h.uow.repos.sourcePaths.listByWorkspace(WORKSPACE)
      const entries = await Promise.all(
        ['intro', 'apple', 'zebra', 'mango'].map(async (name) => {
          const row = rows.find((candidate) => candidate.path === `docs/guides/${name}.md`)
          const document =
            row === undefined ? null : await h.uow.repos.documents.findById(row.documentId)
          return [name, document?.sortKey ?? null] as const
        }),
      )
      return Object.fromEntries(entries)
    }
    expect(await keys()).toEqual({ intro: 1, apple: 2, zebra: 3, mango: null })

    h.source.push({
      id: 'c2',
      files: {
        [MANIFEST]: manifest(GUIDES_AT_DOCS),
        'docs/guides/zebra.md': '# Zebra',
        'docs/guides/apple.md': '# Apple',
        'docs/guides/intro.md': serialise({ order: 1 }, '# Introduction'),
        'docs/guides/mango.md': '# Mango',
      },
    })
    await h.sync()
    expect(await keys()).toEqual({ intro: 1, apple: 2, mango: 3, zebra: 4 })

    // Newest first instead, and the introduction no longer says where it goes.
    h.source.push({
      id: 'c3',
      files: {
        [MANIFEST]: manifest('{ slug: guides, title: Guides, path: docs/guides, order: newest }'),
        'docs/guides/zebra.md': '# Zebra',
        'docs/guides/apple.md': '# Apple',
        'docs/guides/intro.md': '# Introduction',
        'docs/guides/mango.md': '# Mango',
      },
    })
    await h.sync()
    const after = await keys()
    expect(after['mango']).toBe(1)
    expect(Object.values(after).toSorted()).toEqual([1, 2, 3, 4])
  })

  it('re-plans when the stored settings change and the source has not moved', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a.md': '# A', 'ops/run.md': '# Run' } }], {
      collections: [{ collectionId: GUIDES, path: 'docs' }],
    })
    await h.sync()
    expect(await h.sync()).toEqual({ kind: 'up-to-date', revision: 'c1' })

    h.configure({
      collections: [
        { collectionId: GUIDES, path: 'docs' },
        { collectionId: DECISIONS, path: 'ops' },
      ],
    })
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c1', published: 1 })
    expect(h.store.requests[1]?.changeNote).toBe(LAYOUT_CHANGED_SUMMARY)
    expect((await documentAt(h, 'ops/run.md')).collectionId).toBe(DECISIONS)
    expect(await h.sync()).toEqual({ kind: 'up-to-date', revision: 'c1' })

    // A change that only moves documents publishes nothing to the store.
    h.configure({
      collections: [
        { collectionId: DECISIONS, path: 'docs' },
        { collectionId: GUIDES, path: 'ops' },
      ],
    })
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c1', published: 0 })
    expect((await documentAt(h, 'docs/a.md')).collectionId).toBe(DECISIONS)
    expect(h.store.requests).toHaveLength(2)

    // A path taken away archives what it held.
    h.configure({ collections: [{ collectionId: DECISIONS, path: 'docs' }] })
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c1', published: 1 })
    expect((await documentAt(h, 'ops/run.md')).status).toBe('archived')
  })

  it('stays up to date under a manifest whatever the settings say', async () => {
    const h = harness([
      { id: 'c1', files: { [MANIFEST]: manifest(GUIDES_AT_DOCS), 'docs/guides/a.md': '# A' } },
    ])
    await h.sync()
    h.configure({ collections: [{ collectionId: DECISIONS, path: 'elsewhere' }] })
    expect(await h.sync()).toEqual({ kind: 'up-to-date', revision: 'c1' })
  })

  it('re-plans once a tree placed before its layout was recorded', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a.md': serialise({ order: 4 }, '# A') } }])
    await h.sync()
    const recorded = await state(h)
    vi.spyOn(h.uow.repos.sourceSyncState, 'find').mockResolvedValueOnce(
      recorded === null ? null : { ...recorded, layout: null },
    )
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c1', published: 0 })
    expect((await documentAt(h, 'docs/a.md')).sortKey).toBe(4)
  })

  it('stops at a manifest at the head that does not read, naming its line', async () => {
    const h = harness([
      {
        id: 'c1',
        files: {
          [MANIFEST]: manifest('{ slug: guides, title: Guides, path: "**/*.md" }'),
          'docs/a.md': '# A',
        },
      },
    ])
    expect(await h.sync()).toEqual({
      kind: 'failed',
      failure: {
        reason: 'invalid-manifest',
        message: expect.stringMatching(
          /^\.quill\/workspace\.yaml, line 3: .*no directory.* \(at c1\)$/,
        ),
        revision: 'c1',
      },
    })
    expect(h.store.requests).toEqual([])
  })

  it.each([
    [{ kind: 'symbolic-link', target: 'elsewhere.yaml' }, 'symbolic link'],
    [{ kind: 'too-large' }, 'larger than'],
    [{ kind: 'bytes', bytes: new Uint8Array([0xff, 0xfe]) }, 'not UTF-8'],
    [
      [
        'version: 1',
        'workspaces:',
        '  - { slug: a, collections: [{ slug: g, title: G, path: d }] }',
        '  - { slug: b, collections: [{ slug: g, title: G, path: d }] }',
      ].join('\n'),
      'none has the slug',
    ],
  ] as const)('refuses a manifest that is %j', async (spec, message) => {
    const h = harness([{ id: 'c1', files: { [MANIFEST]: spec, 'docs/a.md': '# A' } }])
    expect(await h.sync()).toMatchObject({
      kind: 'failed',
      failure: { reason: 'invalid-manifest', message: expect.stringContaining(message) },
    })
  })

  it('stops when the source does not return the manifest', async () => {
    const h = harness([{ id: 'c1', files: { [MANIFEST]: manifest(GUIDES_AT_DOCS) } }])
    h.source.missing.add(`${MANIFEST}#${JSON.stringify(manifest(GUIDES_AT_DOCS))}`)
    expect(await h.sync()).toMatchObject({ kind: 'failed', failure: { reason: 'file-missing' } })
  })

  it('keeps the layout before a revision whose manifest does not read', async () => {
    const h = harness([
      { id: 'c1', files: { [MANIFEST]: manifest(GUIDES_AT_DOCS), 'docs/guides/a.md': '# A' } },
      {
        id: 'c2',
        files: { [MANIFEST]: 'version: [', 'docs/guides/a.md': '# A', 'docs/guides/b.md': '# B' },
      },
      {
        id: 'c3',
        files: {
          [MANIFEST]: manifest(GUIDES_AT_DOCS),
          'docs/guides/a.md': '# A',
          'docs/guides/b.md': '# B',
        },
      },
    ])
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c3', published: 2 })
    expect(await h.idAt('docs/guides/b.md')).toBeDefined()
  })

  it("places a first revision whose manifest does not read by the head's layout", async () => {
    const h = harness([
      { id: 'c1', files: { [MANIFEST]: 'version: [', 'docs/guides/a.md': '# A' } },
      { id: 'c2', files: { [MANIFEST]: manifest(GUIDES_AT_DOCS), 'docs/guides/a.md': '# A' } },
    ])
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c2', published: 1 })
    const guides = (await collectionsOf(h)).find(({ slug }) => slug === 'guides')
    expect((await documentAt(h, 'docs/guides/a.md')).collectionId).toBe(guides?.id)
  })

  it('archives a document renamed onto a symbolic link', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a.md': '# A' } }])
    await h.sync()
    const id = await h.idAt('docs/a.md')
    h.source.push({
      id: 'c2',
      files: { 'docs/b.md': { kind: 'symbolic-link', target: 'a.md' } },
      renames: { 'docs/a.md': 'docs/b.md' },
    })
    await h.sync()
    expect((await h.uow.repos.documents.findById(id))?.status).toBe('archived')
    expect((await state(h))?.refused).toEqual([
      { path: 'docs/b.md', revision: 'c2', reason: 'symbolic-link' },
    ])
  })

  it('reads the layout again after a revision it skipped on resuming', async () => {
    const h = harness([
      { id: 'c1', files: { [MANIFEST]: manifest(GUIDES_AT_DOCS), 'docs/guides/a.md': '# A' } },
    ])
    await h.sync()
    h.source.push({
      id: 'c2',
      files: { [MANIFEST]: manifest(GUIDES_AT_DOCS), 'docs/guides/a.md': '# A, again' },
    })
    h.source.push({
      id: 'c3',
      files: { [MANIFEST]: manifest(GUIDES_AT_DOCS), 'docs/guides/a.md': '# A, a third time' },
    })
    await h.sync()
    const recorded = await state(h)
    // As if the sync had stopped after recording c2 and c3 but before its state said so.
    vi.spyOn(h.uow.repos.sourceSyncState, 'find').mockResolvedValueOnce(
      recorded === null ? null : { ...recorded, lastSyncedRevision: 'c1' },
    )
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c3', published: 0 })
  })

  it('leaves a collection it retires alone when it is already gone', async () => {
    const h = harness([
      { id: 'c1', files: { [MANIFEST]: manifest(GUIDES_AT_DOCS), 'docs/guides/a.md': '# A' } },
    ])
    await h.sync()
    const recorded = await state(h)
    vi.spyOn(h.uow.repos.sourceSyncState, 'find').mockResolvedValueOnce(
      recorded?.layout == null
        ? null
        : {
            ...recorded,
            layout: {
              ...recorded.layout,
              origin: 'settings',
              fingerprint: 'older',
              collectionIds: ['gone'],
            },
          },
    )
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c1', published: 0 })
    expect(h.uow.events.map((event) => event.type)).not.toContain(COLLECTION_DELETED)
  })
})

describe('requestSourceSync and its consumer', () => {
  it('queues a request that the consumer turns into a sync', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a.md': 'A' } }])
    await requestSourceSync(h.deps, { workspaceId: WORKSPACE, trigger: 'manual' })
    const event = h.uow.events.find((candidate) => candidate.type === SOURCE_SYNC_REQUESTED)
    expect(event?.payload).toEqual({
      version: EVENT_PAYLOAD_VERSION,
      workspaceId: WORKSPACE,
      trigger: 'manual',
    })

    expect(await handleSourceSyncRequested(h.deps, event?.payload)).toEqual({
      kind: 'synced',
      revision: 'c1',
      published: 1,
    })
  })

  it('leaves a payload it cannot read alone', async () => {
    const h = harness([])
    expect(await handleSourceSyncRequested(h.deps, { version: 99 })).toBeNull()
  })
})
