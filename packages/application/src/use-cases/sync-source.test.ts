import { describe, expect, it, vi } from 'vitest'
import { documentId, unitId, userId, workspaceId } from '@quill/domain'
import type { DocumentId, RevisionId, WorkspaceId } from '@quill/domain'

import { AUTHORED_AT_MAX_SKEW_MS } from '../ports/content-store.ts'
import type { ContentAuthor } from '../ports/content-store.ts'
import { ExternalSourceError } from '../ports/external-source.ts'
import type {
  SourceLayoutRecord,
  SourceLinkSettings,
  SourceSettings,
  SourceSyncLock,
} from '../ports/source-sync.ts'
import {
  aShortId,
  createFakeClock,
  createFakeContentStore,
  createFakeDocumentFormat,
  createFakeHasher,
  createFakeIdGenerator,
  createFakeSettings,
  createInMemoryBlobStore,
  pngFile,
  createInMemoryUnitOfWork,
  serialise,
} from '../test-support/index.ts'
import type { FakeContentStore, InMemoryUnitOfWork } from '../test-support/index.ts'
import {
  COLLECTION_DELETED,
  DOCUMENT_MOVED,
  DOCUMENT_NESTED,
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
import { FakeSource, toFile } from '../test-support/fake-external-source.ts'
import type { Commit, FileSpec } from '../test-support/fake-external-source.ts'
import { compareRevisions } from './compare-revisions.ts'
import { renderDocument } from './render-document.ts'
import { readAssetMap, SOURCE_ASSET_MAP_PATH } from './source-assets.ts'
import { generatedFolderPath } from './source-folders.ts'
import type { RenderDocumentDependencies } from './render-document.ts'

const LAYOUT_RECORD: SourceLayoutRecord = {
  origin: 'settings',
  fingerprint: '[]',
  collectionIds: [],
  unknownKeys: [],
}

const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const NOW = new Date('2026-06-01T12:00:00.000Z')
const ADA: ContentAuthor = { name: 'Ada', email: 'ada@example.com' }
const GUIDES = 'collection-guides'
const DECISIONS = 'collection-decisions'

function inMemoryLock(): SourceSyncLock & { readonly held: Set<WorkspaceId> } {
  const held = new Set<WorkspaceId>()
  return {
    held,
    isHeld: async (id) => held.has(id),
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
    manifestEntry: null,
    ...settings,
  }
  let configuredAt = new Date(NOW.getTime() - 60_000)
  const deps: SyncSourceDependencies = {
    uow,
    contentStore: store,
    format: createFakeDocumentFormat(),
    sources: {
      forWorkspace: async (id) =>
        id === WORKSPACE ? { source, settings: resolved, configuredAt } : null,
      withDraft: async () => {
        throw new Error('A sync never opens a draft.')
      },
    },
    lock,
    clock,
    ids: createFakeIdGenerator('aaaa'),
    blobStore: createInMemoryBlobStore(),
    drawingText: { read: async () => null },
    maxAssetBytes: 1024 * 1024,
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
      configuredAt = clock.now()
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

  it('reads the entry its settings name, and places the tree again when they name another', async () => {
    const h = harness(
      [
        {
          id: 'c1',
          files: {
            [MANIFEST]: [
              'version: 1',
              'workspaces:',
              '  - { slug: internal, collections: [{ slug: all, title: All, path: docs }] }',
              '  - { slug: public, collections: [{ slug: public, title: Public, path: docs/public }] }',
            ].join('\n'),
            'docs/public/a.md': '# A',
            'docs/private/b.md': '# B',
          },
        },
      ],
      { manifestEntry: 'public' },
    )
    await h.sync()
    expect((await collectionsOf(h)).map(({ slug }) => slug)).toEqual(['public'])
    await expect(h.idAt('docs/private/b.md')).rejects.toThrow('no path map entry')

    // The head has not moved; saving names another entry, which the next sync reads.
    h.clock.advance(60_000)
    h.configure({ manifestEntry: 'internal' })
    expect(await h.sync()).toMatchObject({ kind: 'synced' })
    expect((await collectionsOf(h)).map(({ slug }) => slug)).toEqual(['all'])
    expect((await documentAt(h, 'docs/private/b.md')).status).toBe('published')

    // Nothing saved since: the next sync has nothing to do.
    h.clock.advance(60_000)
    expect(await h.sync()).toMatchObject({ kind: 'up-to-date' })
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
    // Each folder the guides now read is a document of its own (ADR-061).
    expect(
      h.store.requests[1]?.changes.map((change) =>
        change.kind === 'write' ? change.path : change.kind,
      ),
    ).toEqual([
      'docs/extra/x.md',
      generatedFolderPath('docs/guides'),
      generatedFolderPath('docs/notes'),
      generatedFolderPath('docs/extra'),
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
    const drafts = await h.idAt(generatedFolderPath('docs/drafts'))
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
    // The folder holds nothing any more, so its generated document leaves with it.
    expect(h.store.requests[1]?.changes).toEqual([
      { kind: 'delete', documentId: b, path: 'docs/drafts/b.md' },
      { kind: 'delete', documentId: drafts, path: generatedFolderPath('docs/drafts') },
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
    expect(await h.idAt(generatedFolderPath('docs/drafts'))).toBe(drafts)
    expect((await h.uow.repos.documents.findById(b))?.parentId).toBe(drafts)
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

  it('breaks a tie between siblings by their paths, never by their random ids (ADR-062)', async () => {
    // The two titles and paths are equal to the collator, which ignores
    // accents; the document seen first gets the smaller id, and must not go
    // first for that.
    const h = harness([
      {
        id: 'c1',
        files: {
          [MANIFEST]: manifest(GUIDES_AT_DOCS),
          'docs/guides/résumé.md': '# Résumé',
          'docs/guides/resume.md': '# Resume',
        },
      },
    ])
    await h.sync()
    const accented = await documentAt(h, 'docs/guides/résumé.md')
    const plain = await documentAt(h, 'docs/guides/resume.md')
    expect(accented.id < plain.id).toBe(true)
    expect([plain.sortKey, accented.sortKey]).toEqual([1, 2])
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

// ---------------------------------------------------------------------------
// Relative links (ADR-061, "Relative links, resolved at render")
// ---------------------------------------------------------------------------

/** A sourced workspace, as configuring one stores it, for the render to read its settings from. */
async function sourced(
  h: Harness,
  settings: Partial<SourceLinkSettings & { readonly remote: string }> = {},
): Promise<void> {
  await h.uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Handbook',
    slug: 'handbook',
    now: NOW,
  })
  await h.uow.repos.workspaceSources.put({
    workspaceId: WORKSPACE,
    remote: 'https://github.com/acme/handbook.git',
    branch: 'main',
    collections: [],
    history: 'full',
    commitMessages: 'subject',
    manifestEntry: null,
    credential: null,
    outsideLinks: 'forge',
    viewTemplate: null,
    webhookSecretName: null,
    configuredBy: userId('00000000-0000-4000-8000-000000000001'),
    now: NOW,
    ...settings,
  })
}

/** A synced document rendered, as a reader's request renders it. */
async function render(h: Harness, path: string, revision?: RevisionId) {
  const deps: RenderDocumentDependencies = {
    uow: h.uow,
    contentStore: h.store,
    format: h.deps.format,
    clock: h.clock,
    ids: createFakeIdGenerator('bbbb'),
    hasher: createFakeHasher(),
    // The store the sync job put the assets in.
    blobStore: h.deps.blobStore,
    settings: createFakeSettings(),
  }
  const rendered = await renderDocument(deps, { documentId: await h.idAt(path), revision })
  if (rendered.kind !== 'rendered') throw new Error(rendered.kind)
  return rendered
}

describe('relative links', () => {
  const broken = async (h: Harness) =>
    (await state(h))?.brokenLinks?.map(({ path, url, revision }) => `${path} ${url} @${revision}`)

  const GUIDE = [
    '# Guide',
    '[the decision](adr/0001-auth.md#rotation)',
    '[the code](../src/app.ts#L3)',
    '[missing](./missing.md)',
    '[climbing](../../../etc/passwd)',
    '[the root](../)',
    '[elsewhere](https://example.test/a.md)',
    '[this page](#guide)',
  ].join('\n')

  describe('found broken at sync', () => {
    it('lists the links to paths not in the repository at the head, and those that leave it', async () => {
      const h = harness([
        {
          id: 'c1',
          files: {
            'docs/guide.md': GUIDE,
            'docs/adr/0001-auth.md': '# Auth',
            'src/app.ts': 'export {}',
          },
        },
      ])
      await h.sync()

      expect(await broken(h)).toEqual([
        'docs/guide.md ../../../etc/passwd @c1',
        'docs/guide.md ./missing.md @c1',
      ])
      // Outside the source's paths is still in the repository; the root is never asked about.
      expect(h.source.asked.flat().toSorted()).toEqual([
        'docs/adr/0001-auth.md',
        'docs/missing.md',
        'src/app.ts',
      ])
    })

    it('checks a listed document again, so a path that appears takes its link off the list', async () => {
      const files = { 'docs/guide.md': GUIDE, 'docs/adr/0001-auth.md': '# Auth' }
      const h = harness([{ id: 'c1', files }])
      await h.sync()
      h.source.push({ id: 'c2', files: { ...files, 'docs/missing.md': '# Here now' } })
      await h.sync()

      expect(await broken(h)).toEqual([
        'docs/guide.md ../../../etc/passwd @c2',
        'docs/guide.md ../src/app.ts#L3 @c2',
      ])
    })

    it('checks the documents that linked to one this sync removed, through the link index', async () => {
      const files = {
        'docs/guide.md': '[the decision](adr/0001-auth.md)',
        'docs/adr/0001-auth.md': '# Auth',
        'docs/other.md': '# Other',
      }
      const h = harness([{ id: 'c1', files }])
      await sourced(h)
      await h.sync()
      // The render after a publish is what records the links (`render-on-publish`).
      await render(h, 'docs/guide.md')
      const { 'docs/adr/0001-auth.md': _removed, ...rest } = files
      h.source.push({ id: 'c2', files: rest })
      await h.sync()

      expect(await broken(h)).toEqual(['docs/guide.md adr/0001-auth.md @c2'])
    })

    it('keeps what it found when a sync wrote nothing, and asks nothing', async () => {
      const files = { 'docs/guide.md': '[gone](gone.md)', 'src/app.ts': 'export {}' }
      const h = harness([{ id: 'c1', files }])
      await h.sync()
      const asked = h.source.asked.length
      h.source.push({ id: 'c2', files: { ...files, 'src/app.ts': 'export const a = 1' } })
      await h.sync()

      expect(await broken(h)).toEqual(['docs/guide.md gone.md @c1'])
      expect(h.source.asked).toHaveLength(asked)
    })

    it('checks every document when the last check is unknown, and forgets a removed one', async () => {
      const files = {
        'docs/guide.md': '[gone](gone.md)',
        'docs/other.md': '[also gone](gone.md) [root](../)',
      }
      const h = harness([{ id: 'c1', files }])
      await h.sync()
      const recorded = await state(h)
      await h.uow.repos.sourceSyncState.recordSynced({
        workspaceId: WORKSPACE,
        revision: 'c1',
        refused: [],
        layout: recorded?.layout ?? LAYOUT_RECORD,
        // As a sync that stopped part-way leaves it.
        brokenLinks: null,
        now: NOW,
      })
      const { 'docs/guide.md': _removed, ...rest } = files
      h.source.push({ id: 'c2', files: rest })
      await h.sync()

      expect(await broken(h)).toEqual(['docs/other.md gone.md @c2'])
    })

    it('records the links as unchecked while a sync is part-way', async () => {
      const h = harness([
        { id: 'c1', files: { 'docs/a.md': '[gone](gone.md)' } },
        { id: 'c2', files: { 'docs/a.md': '[gone](gone.md) again' } },
      ])
      const seen: unknown[] = []
      const repository = h.uow.repos.sourceSyncState
      const record = repository.recordSynced.bind(repository)
      vi.spyOn(repository, 'recordSynced').mockImplementation(async (input) => {
        seen.push(input.brokenLinks)
        await record(input)
      })
      await h.sync()

      expect(seen).toEqual([null, null, [expect.objectContaining({ url: 'gone.md' })]])
    })
  })

  describe('resolved at render', () => {
    it('sends a link to a document of the revision, to the forge at the synced commit, or to its words', async () => {
      const h = harness([
        {
          id: 'c1',
          files: {
            'docs/guide.md': GUIDE,
            'docs/adr/0001-auth.md': '# Auth',
            'src/app.ts': 'export {}',
          },
        },
      ])
      await sourced(h)
      await h.sync()
      const decision = await h.idAt('docs/adr/0001-auth.md')
      const guide = await h.idAt('docs/guide.md')

      const { html } = (await render(h, 'docs/guide.md')).content

      const forge = 'https://github.com/acme/handbook/blob/c1'
      expect(html).toContain(`[the decision](/d/${decision}#user-content-rotation)`)
      expect(html).toContain(`[the code](${forge}/src/app.ts#L3)`)
      expect(html).toContain(`[missing](${forge}/docs/missing.md)`)
      expect(html).toContain('\nclimbing\n')
      expect(html).toContain(`[the root](${forge}/)`)
      expect(html).toContain('[elsewhere](https://example.test/a.md)')
      expect(html).toContain('[this page](#guide)')
      // The index records where the link went, so backlinks work.
      expect(await h.uow.repos.documentLinks.listSourcesTargeting(decision)).toEqual([guide])
    })

    it('renders an older revision against its own documents and its own commit', async () => {
      const files = {
        'docs/guide.md': '[the decision](adr/0001-auth.md) [the code](../src/app.ts)',
        'docs/adr/0001-auth.md': '# Auth',
        'src/app.ts': 'export {}',
      }
      const h = harness([{ id: 'c1', files }])
      await sourced(h)
      await h.sync()
      const first = await h.store.head(WORKSPACE)
      if (first === null) throw new Error('nothing was published')
      const decision = await h.idAt('docs/adr/0001-auth.md')
      const { 'docs/adr/0001-auth.md': _removed, ...rest } = files
      h.source.push({ id: 'c2', files: { ...rest, 'docs/guide.md': `${files['docs/guide.md']}.` } })
      await h.sync()

      const older = await render(h, 'docs/guide.md', first)
      expect(older.content.html).toContain(`[the decision](/d/${decision})`)
      expect(older.content.html).toContain('/blob/c1/src/app.ts')

      // The decision's file is gone at the head: its link goes to its page,
      // which says it was removed, not to a forge page that is not there.
      const head = await render(h, 'docs/guide.md')
      expect(head.content.html).toContain(`[the decision](/d/${decision})`)
      expect(head.content.html).toContain('/blob/c2/src/app.ts')
      expect(head.key).not.toBe(older.key)
    })

    it('shows a link outside the source as its words when the source asks, or knows no forge', async () => {
      const files = { 'docs/guide.md': '[the code](../src/app.ts)', 'src/app.ts': 'export {}' }
      const asked = harness([{ id: 'c1', files }])
      await sourced(asked, { outsideLinks: 'text' })
      await asked.sync()
      expect((await render(asked, 'docs/guide.md')).content.html).toContain('<article>the code')

      const unknown = harness([{ id: 'c1', files }])
      await sourced(unknown, { remote: 'https://git.example.com/acme/handbook.git' })
      await unknown.sync()
      expect((await render(unknown, 'docs/guide.md')).content.html).toContain('<article>the code')

      const named = harness([{ id: 'c1', files }])
      await sourced(named, {
        remote: 'https://git.example.com/acme/handbook.git',
        viewTemplate: 'https://git.example.com/acme/handbook/src/{commit}/{path}',
      })
      await named.sync()
      expect((await render(named, 'docs/guide.md')).content.html).toContain(
        '[the code](https://git.example.com/acme/handbook/src/c1/src/app.ts)',
      )
    })

    it('leaves the links of a workspace with no stored source as they were written', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/guide.md': '[a](./a.md)', 'docs/a.md': 'A' } }])
      await h.sync()
      expect((await render(h, 'docs/guide.md')).content.html).toContain('[a](./a.md)')
    })

    it('shows links to the forge as words when no synced commit is recorded', async () => {
      const h = harness([{ id: 'c1', files: { 'docs/guide.md': '[code](../src/a.ts)' } }])
      await sourced(h)
      await h.sync()
      vi.spyOn(h.uow.repos.sourceSyncState, 'find').mockResolvedValue(null)
      expect((await render(h, 'docs/guide.md')).content.html).toContain('<article>code')
    })
  })
})

// ---------------------------------------------------------------------------
// Repository assets (ADR-061, "Repository assets, as content-addressed attachments")
// ---------------------------------------------------------------------------

/** A file's bytes, as a fake source holds them. */
const bytes = (data: Uint8Array): FileSpec => ({ kind: 'bytes', bytes: data })

describe('repository assets', () => {
  const ASSET_MANIFEST = [
    'version: 1',
    'collections:',
    '  - { slug: guides, title: Guides, path: docs }',
    'assets: [diagrams]',
    '',
  ].join('\n')
  const FLOW = pngFile({ width: 2, height: 1 })
  const SHOT = pngFile({ width: 1, height: 2 })
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>'
  const GUIDE = [
    '# Guide',
    '![Flow](../diagrams/flow.png)',
    '![Shot](shot.png)',
    '![Arch](../diagrams/arch.svg)',
    '![Gone](./gone.png)',
    '![Fake](../diagrams/fake.png)',
    '![Up](../../up.png)',
    '[the diagram](../diagrams/flow.png)',
    '![Elsewhere](https://example.test/a.png)',
  ].join('\n')
  const FILES: Readonly<Record<string, FileSpec>> = {
    '.quill/workspace.yaml': ASSET_MANIFEST,
    'docs/guide.md': GUIDE,
    'docs/shot.png': bytes(SHOT),
    'diagrams/flow.png': bytes(FLOW),
    'diagrams/copy.png': bytes(FLOW),
    'diagrams/arch.svg': SVG,
    'diagrams/notes.txt': 'plain words',
    'diagrams/fake.png': 'not a picture',
    'diagrams/huge.png': { kind: 'too-large' },
    'diagrams/link.png': { kind: 'symbolic-link', target: '../docs/shot.png' },
    'diagrams/readme.md': '# Not an asset',
  }

  const assetsOf = async (h: Harness) =>
    Object.fromEntries(
      (await h.uow.repos.sourceAssets.listByWorkspace(WORKSPACE)).map((row) => [
        row.path,
        row.attachmentId,
      ]),
    )

  it('imports the assets and a collection’s images once per distinct content, and lists what it refused', async () => {
    const h = harness([{ id: 'c1', files: FILES }])
    await h.sync()

    const assets = await assetsOf(h)
    expect(Object.keys(assets).toSorted()).toEqual([
      'diagrams/arch.svg',
      'diagrams/copy.png',
      'diagrams/flow.png',
      'docs/shot.png',
    ])
    // The same bytes are one attachment, whichever path holds them.
    expect(assets['diagrams/copy.png']).toBe(assets['diagrams/flow.png'])
    const owned = await h.uow.repos.attachments.listSourceOwned(WORKSPACE)
    expect(
      owned.map(({ filename, contentType, documentId: owner, sourceWorkspaceId }) => ({
        filename,
        contentType,
        documentId: owner,
        sourceWorkspaceId,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          filename: 'flow.png',
          contentType: 'image/png',
          documentId: null,
          sourceWorkspaceId: WORKSPACE,
        },
        {
          filename: 'shot.png',
          contentType: 'image/png',
          documentId: null,
          sourceWorkspaceId: WORKSPACE,
        },
        {
          filename: 'arch.svg',
          contentType: 'image/svg+xml',
          documentId: null,
          sourceWorkspaceId: WORKSPACE,
        },
      ]),
    )
    expect(owned).toHaveLength(3)
    expect(
      (await state(h))?.refused.map(({ path, reason }) => `${path} ${reason}`).toSorted(),
    ).toEqual([
      'diagrams/fake.png type-not-allowed',
      'diagrams/huge.png too-large',
      'diagrams/link.png symbolic-link',
      'diagrams/notes.txt type-not-allowed',
    ])
  })

  it('draws an image from its attachment, an SVG as a drawing, and any other as its words', async () => {
    const h = harness([{ id: 'c1', files: FILES }])
    await sourced(h)
    await h.sync()
    const assets = await assetsOf(h)

    const { html } = (await render(h, 'docs/guide.md')).content

    expect(html).toContain(`![Flow](/api/attachments/${assets['diagrams/flow.png']})`)
    expect(html).toContain(`![Shot](/api/attachments/${assets['docs/shot.png']})`)
    expect(html).toContain(`<drawing src="/api/attachments/${assets['diagrams/arch.svg']}">${SVG}`)
    // Not in the repository, refused, and outside it: the alternative text.
    expect(html).toContain('\nGone\nFake\nUp\n')
    // A link to an asset is a link to a file outside the documents: the forge.
    expect(html).toContain(
      '[the diagram](https://github.com/acme/handbook/blob/c1/diagrams/flow.png)',
    )
  })

  it('takes in a changed asset, reads no unchanged one again, and keeps the old one for the revisions that had it', async () => {
    const h = harness([{ id: 'c1', files: FILES }])
    await h.sync()
    const before = await assetsOf(h)
    const read = vi.spyOn(h.source, 'readFiles')
    const { 'diagrams/copy.png': _copy, ...rest } = FILES
    h.source.push({
      id: 'c2',
      files: { ...rest, 'diagrams/flow.png': bytes(pngFile({ width: 3 })) },
    })
    await h.sync()

    const after = await assetsOf(h)
    expect(after['diagrams/copy.png']).toBeUndefined()
    expect(after['diagrams/flow.png']).not.toBe(before['diagrams/flow.png'])
    expect(after['docs/shot.png']).toBe(before['docs/shot.png'])
    const asked = read.mock.calls.flatMap(([ids]) => [...ids])
    expect(asked.some((id) => id.startsWith('docs/shot.png#'))).toBe(false)
    // A stored revision still shows it, and history is never rewritten.
    const old = await h.uow.repos.attachments.findById(before['diagrams/flow.png'] ?? '')
    expect(old?.deletedAt).toBeNull()
  })

  it('keeps the asset map with each stored revision, written before the revision it changes with', async () => {
    const h = harness([{ id: 'c1', files: FILES }])
    await h.sync()
    const first = await assetsOf(h)
    const stored = async (revision?: RevisionId) => {
      const file = await h.store.readFile(WORKSPACE, SOURCE_ASSET_MAP_PATH, revision)
      return file === null ? null : Object.fromEntries(readAssetMap(file.text) ?? [])
    }
    expect(await stored()).toEqual(first)

    // An asset-only revision is stored too; an unchanged map writes nothing.
    h.source.push({
      id: 'c2',
      files: { ...FILES, 'diagrams/flow.png': bytes(pngFile({ width: 3 })) },
    })
    await h.sync()
    expect((await stored())?.['diagrams/flow.png']).not.toBe(first['diagrams/flow.png'])
    const writes = h.store.writtenFiles.length
    h.source.push({
      id: 'c3',
      files: {
        ...FILES,
        'diagrams/flow.png': bytes(pngFile({ width: 3 })),
        'docs/guide.md': `${GUIDE}\nMore.`,
      },
    })
    await h.sync()
    expect(h.store.writtenFiles).toHaveLength(writes)
  })

  it('renders each revision with the pictures it had, and remembers who may see them', async () => {
    const h = harness([{ id: 'c1', files: FILES }])
    await sourced(h)
    await h.sync()
    const first = await h.store.head(WORKSPACE)
    if (first === null) throw new Error('nothing was published')
    const old = await assetsOf(h)
    const { 'docs/shot.png': _shot, ...rest } = FILES
    h.source.push({
      id: 'c2',
      files: {
        ...rest,
        'diagrams/flow.png': bytes(pngFile({ width: 3 })),
        'docs/guide.md': `${GUIDE}\nChanged.`,
      },
    })
    await h.sync()
    const now = await assetsOf(h)

    const older = (await render(h, 'docs/guide.md', first)).content.html
    expect(older).toContain(`![Flow](/api/attachments/${old['diagrams/flow.png']})`)
    // Removed since, and still shown where it was.
    expect(older).toContain(`![Shot](/api/attachments/${old['docs/shot.png']})`)
    const head = (await render(h, 'docs/guide.md')).content.html
    expect(head).toContain(`![Flow](/api/attachments/${now['diagrams/flow.png']})`)
    expect(head).toContain('\nShot\n')

    const guide = await h.idAt('docs/guide.md')
    const history = h.uow.repos.sourceAssetHistory
    expect(await history.listDocumentsShowing(old['diagrams/flow.png'] ?? '')).toEqual([guide])
    expect(await history.listDocumentsShowing(old['docs/shot.png'] ?? '')).toEqual([guide])
    expect(await history.listDocumentsShowing('nothing')).toEqual([])
  })

  it('compares two revisions each with the pictures it had', async () => {
    const h = harness([{ id: 'c1', files: FILES }])
    await sourced(h)
    await h.sync()
    const first = await h.store.head(WORKSPACE)
    const old = await assetsOf(h)
    h.source.push({
      id: 'c2',
      files: {
        ...FILES,
        'diagrams/flow.png': bytes(pngFile({ width: 3 })),
        'docs/guide.md': `${GUIDE}\nChanged.`,
      },
    })
    await h.sync()
    const second = await h.store.head(WORKSPACE)
    const now = await assetsOf(h)
    if (first === null || second === null) throw new Error('nothing was published')
    const compare = vi.spyOn(h.deps.format, 'compare')

    const compared = await compareRevisions(
      {
        uow: h.uow,
        contentStore: h.store,
        format: h.deps.format,
        hasher: createFakeHasher(),
        blobStore: h.deps.blobStore,
        settings: createFakeSettings(),
      },
      { documentId: await h.idAt('docs/guide.md'), from: first, to: second },
    )

    expect(compared.kind).toBe('compared')
    const [input] = compare.mock.calls.at(-1) ?? []
    const flow = '../diagrams/flow.png'
    expect(input?.beforeResolved?.resolvedImages?.get(flow)).toEqual({
      kind: 'href',
      href: `/api/attachments/${old['diagrams/flow.png']}`,
    })
    expect(input?.context.resolvedImages?.get(flow)).toEqual({
      kind: 'href',
      href: `/api/attachments/${now['diagrams/flow.png']}`,
    })
  })

  it('renders from the map as it is now for a revision stored before the map was kept', async () => {
    const h = harness([{ id: 'c1', files: FILES }])
    await sourced(h)
    await h.sync()
    const assets = await assetsOf(h)
    vi.spyOn(h.store, 'readFile').mockResolvedValue({
      path: SOURCE_ASSET_MAP_PATH,
      text: '{',
      revision: 'r' as RevisionId,
    })
    expect((await render(h, 'docs/guide.md')).content.html).toContain(
      `![Flow](/api/attachments/${assets['diagrams/flow.png']})`,
    )
  })

  it('stops when the store moved under the asset map', async () => {
    const h = harness([{ id: 'c1', files: FILES }])
    vi.spyOn(h.store, 'putFile').mockResolvedValue({ kind: 'stale', current: null })
    expect(await h.sync()).toMatchObject({ kind: 'failed', failure: { reason: 'store-moved' } })
  })

  it('re-plans the assets with the layout: a path gone from the revision leaves the map', async () => {
    const h = harness([{ id: 'c1', files: FILES }])
    await h.sync()
    const { 'diagrams/copy.png': _copy, ...rest } = FILES
    h.source.push({
      id: 'c2',
      files: {
        ...rest,
        '.quill/workspace.yaml': ASSET_MANIFEST.replace('[diagrams]', '[diagrams, art]'),
      },
    })
    await h.sync()
    expect(Object.keys(await assetsOf(h))).not.toContain('diagrams/copy.png')
  })

  it('reconciles the assets at the head after skipping a revision already recorded', async () => {
    const h = harness([{ id: 'c1', files: FILES }])
    await h.sync()
    h.source.push({ id: 'c2', files: { ...FILES, 'docs/guide.md': `${GUIDE}\nMore.` } })
    await h.sync()
    // As if the last sync had stopped after recording c2 but before saying so.
    const recorded = await state(h)
    await h.uow.repos.sourceSyncState.recordSynced({
      workspaceId: WORKSPACE,
      revision: 'c1',
      refused: [],
      layout: recorded?.layout ?? LAYOUT_RECORD,
      brokenLinks: recorded?.brokenLinks ?? null,
      now: NOW,
    })
    await h.uow.repos.sourceAssets.remove(WORKSPACE, 'docs/shot.png')

    expect(await h.sync()).toMatchObject({ kind: 'synced', published: 0 })
    expect(Object.keys(await assetsOf(h))).toContain('docs/shot.png')
  })

  it('fails the sync when the source does not return an asset’s contents', async () => {
    const h = harness([{ id: 'c1', files: { ...FILES } }])
    h.source.missing.add(toFile('docs/shot.png', bytes(SHOT)).fileId)
    expect(await h.sync()).toMatchObject({ kind: 'failed', failure: { reason: 'file-missing' } })
  })
})

// ---------------------------------------------------------------------------
// Folders as documents (ADR-061, "Tree, titles and order")
// ---------------------------------------------------------------------------

describe('folders as documents', () => {
  const CONCEPTS = generatedFolderPath('docs/guide/concepts')
  /** lockstay's guide: folders with a README, and one without. */
  const GUIDE_FILES = {
    'docs/guide/README.md': [
      '# Guide',
      '[Tenancy](./concepts/tenancy/README.md)',
      '[Requests](./concepts/requests/)',
      '[Concepts](concepts)',
      '[Isolation](concepts/tenancy/isolation.md)',
      '[Nowhere](./concepts/nowhere/)',
    ].join('\n\n'),
    'docs/guide/concepts/tenancy/README.md': '# Tenancy',
    'docs/guide/concepts/tenancy/isolation.md': '# Isolation',
    'docs/guide/concepts/requests/README.md': '# Requests',
    'docs/top.md': '# Top',
  }

  const parentOf = async (h: Harness, path: string) => (await documentAt(h, path)).parentId

  it("nests a folder's documents under its README, and writes a titled document for a folder with none", async () => {
    const h = harness([{ id: 'c1', files: GUIDE_FILES }])
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c1', published: 1 })

    const guide = await h.idAt('docs/guide/README.md')
    const concepts = await h.idAt(CONCEPTS)
    const tenancy = await h.idAt('docs/guide/concepts/tenancy/README.md')
    // The collection's own directory is the collection: its files are at the top.
    expect(await parentOf(h, 'docs/top.md')).toBeNull()
    expect(await parentOf(h, 'docs/guide/README.md')).toBeNull()
    expect(await parentOf(h, CONCEPTS)).toBe(guide)
    expect(await parentOf(h, 'docs/guide/concepts/tenancy/README.md')).toBe(concepts)
    expect(await parentOf(h, 'docs/guide/concepts/requests/README.md')).toBe(concepts)
    expect(await parentOf(h, 'docs/guide/concepts/tenancy/isolation.md')).toBe(tenancy)

    expect(await documentAt(h, CONCEPTS)).toMatchObject({
      title: 'Concepts',
      collectionId: GUIDES,
      status: 'published',
    })
    expect(await h.stored(CONCEPTS)).toBe(
      serialise({ id: concepts }, '# Concepts\n\n::children{excerpts}\n'),
    )
    // It is published with the files that made it, in the one revision.
    expect(h.store.requests[0]?.changes).toContainEqual(
      expect.objectContaining({ kind: 'write', path: CONCEPTS, documentId: concepts }),
    )
    expect(
      h.uow.events
        .filter((event) => event.type === DOCUMENT_NESTED)
        .map((event) => (event.payload as { documentId: string }).documentId),
    ).toContain(concepts)
  })

  it("puts a collection's own README first, unless its front matter says where it goes", async () => {
    const BETA = serialise({ order: 1 }, '# Beta')
    const h = harness([
      {
        id: 'c1',
        files: {
          'docs/README.md': '# Zed overview',
          'docs/alpha.md': '# Alpha',
          'docs/beta.md': BETA,
        },
      },
    ])
    await h.sync()
    const key = async (path: string) => (await documentAt(h, path)).sortKey ?? 0
    expect(await key('docs/README.md')).toBeLessThan(await key('docs/beta.md'))
    expect(await key('docs/beta.md')).toBeLessThan(await key('docs/alpha.md'))

    h.source.push({
      id: 'c2',
      files: {
        'docs/README.md': serialise({ order: 5 }, '# Zed overview'),
        'docs/alpha.md': '# Alpha',
        'docs/beta.md': BETA,
      },
    })
    await h.sync()
    expect(await key('docs/README.md')).toBe(5)
  })

  it("orders a folder's document among its siblings by the folder's name", async () => {
    const h = harness([
      {
        id: 'c1',
        files: {
          [MANIFEST]: manifest('{ slug: docs, title: Docs, path: docs, order: filename }'),
          'docs/b.md': '# Zed',
          'docs/a/README.md': '# Yak',
          'docs/c/x.md': '# Ant',
        },
      },
    ])
    await h.sync()
    const keys = async (...paths: string[]) =>
      await Promise.all(paths.map(async (path) => (await documentAt(h, path)).sortKey))
    expect(await keys('docs/a/README.md', 'docs/b.md', generatedFolderPath('docs/c'))).toEqual([
      1, 2, 3,
    ])
    // Siblings are ordered within their parent.
    expect(await keys('docs/c/x.md')).toEqual([1])
  })

  it("resolves a link to a folder's README, to the folder, and to it with a slash, to the folder's document", async () => {
    const h = harness([{ id: 'c1', files: GUIDE_FILES }])
    await sourced(h)
    await h.sync()
    const { html } = (await render(h, 'docs/guide/README.md')).content
    const tenancy = await h.idAt('docs/guide/concepts/tenancy/README.md')
    const requests = await h.idAt('docs/guide/concepts/requests/README.md')
    const concepts = await h.idAt(CONCEPTS)
    const isolation = await h.idAt('docs/guide/concepts/tenancy/isolation.md')
    expect(html).toContain(`[Tenancy](/d/${tenancy})`)
    expect(html).toContain(`[Requests](/d/${requests})`)
    expect(html).toContain(`[Concepts](/d/${concepts})`)
    expect(html).toContain(`[Isolation](/d/${isolation})`)
    expect(html).toContain(
      '[Nowhere](https://github.com/acme/handbook/blob/c1/docs/guide/concepts/nowhere)',
    )
    // Only the folder that is not there is broken.
    expect((await state(h))?.brokenLinks).toEqual([
      { path: 'docs/guide/README.md', url: './concepts/nowhere/', revision: 'c1' },
    ])
    expect(await h.uow.repos.documentLinks.listSourcesTargeting(concepts)).toEqual([
      await h.idAt('docs/guide/README.md'),
    ])
  })

  it("gives a folder's generated document to the README it gains, and keeps it when the README goes", async () => {
    const tenancyFiles = { 'docs/guide/concepts/tenancy/README.md': '# Tenancy' }
    const h = harness([{ id: 'c1', files: tenancyFiles }])
    await h.sync()
    const concepts = await h.idAt(CONCEPTS)

    h.source.push({
      id: 'c2',
      files: { ...tenancyFiles, 'docs/guide/concepts/README.md': '# Core concepts' },
    })
    await h.sync()
    expect(await h.idAt('docs/guide/concepts/README.md')).toBe(concepts)
    await expect(h.idAt(CONCEPTS)).rejects.toThrow('no path map entry')
    expect(h.store.requests[1]?.changes).toEqual([
      {
        kind: 'move',
        documentId: concepts,
        fromPath: CONCEPTS,
        toPath: 'docs/guide/concepts/README.md',
        markdown: serialise({ id: concepts }, '# Core concepts'),
      },
    ])
    expect(await documentAt(h, 'docs/guide/concepts/README.md')).toMatchObject({
      title: 'Core concepts',
      status: 'published',
    })
    expect(await parentOf(h, 'docs/guide/concepts/tenancy/README.md')).toBe(concepts)

    h.source.push({ id: 'c3', files: tenancyFiles })
    await h.sync()
    expect(await h.idAt(CONCEPTS)).toBe(concepts)
    expect(await documentAt(h, CONCEPTS)).toMatchObject({ title: 'Concepts', status: 'published' })
    expect(h.store.requests[2]?.changes).toEqual([
      expect.objectContaining({ kind: 'move', documentId: concepts, toPath: CONCEPTS }),
    ])
    expect(await parentOf(h, 'docs/guide/concepts/tenancy/README.md')).toBe(concepts)
    // One page all along, with every revision in its history.
    const recorded = await Promise.all(
      ['c1', 'c2', 'c3'].map(async (commit) =>
        h.uow.repos.revisions.findBySourceRevision(WORKSPACE, commit),
      ),
    )
    for (const row of recorded) {
      if (row === null) throw new Error('a revision was not recorded')
      expect(await h.uow.repos.revisions.findForDocument(concepts, row.revision)).not.toBeNull()
    }
  })

  it('archives a folder document when its folder empties, and brings it back with its id', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a/b.md': '# B', 'docs/c.md': '# C' } }])
    await h.sync()
    const folder = await h.idAt(generatedFolderPath('docs/a'))

    h.source.push({ id: 'c2', files: { 'docs/c.md': '# C' } })
    await h.sync()
    expect((await h.uow.repos.documents.findById(folder))?.status).toBe('archived')
    expect(h.store.requests[1]?.changes).toContainEqual({
      kind: 'delete',
      documentId: folder,
      path: generatedFolderPath('docs/a'),
    })

    h.source.push({ id: 'c3', files: { 'docs/a/b.md': '# B', 'docs/c.md': '# C' } })
    await h.sync()
    expect(await h.idAt(generatedFolderPath('docs/a'))).toBe(folder)
    expect((await h.uow.repos.documents.findById(folder))?.status).toBe('published')
    expect(await parentOf(h, 'docs/a/b.md')).toBe(folder)
  })

  it("moves a renamed folder's generated documents with it", async () => {
    const h = harness([
      { id: 'c1', files: { 'docs/a/x/one.md': '# One', 'docs/a/x/two.md': '# Two' } },
    ])
    await h.sync()
    const a = await h.idAt(generatedFolderPath('docs/a'))
    const x = await h.idAt(generatedFolderPath('docs/a/x'))

    h.source.push({
      id: 'c2',
      files: { 'docs/b/x/one.md': '# One', 'docs/b/x/two.md': '# Two' },
      renames: { 'docs/a/x/one.md': 'docs/b/x/one.md', 'docs/a/x/two.md': 'docs/b/x/two.md' },
    })
    await h.sync()
    expect(await h.idAt(generatedFolderPath('docs/b'))).toBe(a)
    expect(await h.idAt(generatedFolderPath('docs/b/x'))).toBe(x)
    expect(await documentAt(h, generatedFolderPath('docs/b'))).toMatchObject({ title: 'B' })
    expect(await parentOf(h, 'docs/b/x/one.md')).toBe(x)
    expect(await parentOf(h, generatedFolderPath('docs/b/x'))).toBe(a)
  })

  it('keeps a README beside an index.md as its child, and makes it the folder document when the index goes', async () => {
    const h = harness([
      {
        id: 'c1',
        files: { 'docs/a/index.md': '# Index', 'docs/a/README.md': '# Readme', 'docs/a/b.md': 'B' },
      },
    ])
    await h.sync()
    const index = await h.idAt('docs/a/index.md')
    expect(await parentOf(h, 'docs/a/README.md')).toBe(index)
    expect(await parentOf(h, 'docs/a/b.md')).toBe(index)

    h.source.push({ id: 'c2', files: { 'docs/a/README.md': '# Readme', 'docs/a/b.md': 'B' } })
    await h.sync()
    const readme = await h.idAt('docs/a/README.md')
    expect((await h.uow.repos.documents.findById(index))?.status).toBe('archived')
    expect(await parentOf(h, 'docs/a/README.md')).toBeNull()
    expect(await parentOf(h, 'docs/a/b.md')).toBe(readme)
  })

  it('places a generated document again with its folder when the layout changes', async () => {
    const h = harness([{ id: 'c1', files: { 'docs/a/b.md': '# B' } }], {
      collections: [{ collectionId: GUIDES, path: 'docs' }],
    })
    await h.sync()
    const folder = await h.idAt(generatedFolderPath('docs/a'))

    h.configure({ collections: [{ collectionId: DECISIONS, path: 'docs' }] })
    expect(await h.sync()).toMatchObject({ kind: 'synced', published: 0 })
    expect(await h.idAt(generatedFolderPath('docs/a'))).toBe(folder)
    expect(await documentAt(h, generatedFolderPath('docs/a'))).toMatchObject({
      collectionId: DECISIONS,
      status: 'published',
    })
    expect(await parentOf(h, 'docs/a/b.md')).toBe(folder)
  })

  it('reads a rename from the top of the repository into a folder of another collection', async () => {
    const h = harness([{ id: 'c1', files: { 'a/one.md': '# One' } }], {
      collections: [
        { collectionId: GUIDES, path: 'a' },
        { collectionId: DECISIONS, path: 'b' },
      ],
    })
    await h.sync()
    const one = await h.idAt('a/one.md')
    h.source.push({
      id: 'c2',
      files: { 'b/a/one.md': '# One' },
      renames: { 'a/one.md': 'b/a/one.md' },
    })
    expect(await h.sync()).toMatchObject({ kind: 'synced' })
    expect(await h.idAt('b/a/one.md')).toBe(one)
    expect(await parentOf(h, 'b/a/one.md')).toBe(await h.idAt(generatedFolderPath('b/a')))
  })

  it('ignores a repository file at the path a generated document takes', async () => {
    const h = harness([
      { id: 'c1', files: { 'docs/a/b.md': '# B', [generatedFolderPath('docs/a')]: '# Mine' } },
    ])
    await h.sync()
    expect(await h.stored(generatedFolderPath('docs/a'))).toContain('# A')
    h.source.push({ id: 'c2', files: { 'docs/a/b.md': '# B' } })
    await h.sync()
    expect((await documentAt(h, generatedFolderPath('docs/a'))).status).toBe('published')
  })

  /**
   * The workspace as the release before folders were documents left it: no
   * generated documents, every document at the top of its collection, and a
   * layout fingerprint with no tree in it.
   */
  async function asBeforeFolders(h: Harness): Promise<void> {
    const { repos } = h.uow
    for (const row of await repos.sourcePaths.listByWorkspace(WORKSPACE)) {
      if (!row.path.endsWith('/.quill/folder.md')) continue
      await h.store.publish({
        workspaceId: WORKSPACE,
        changes: [{ kind: 'delete', documentId: row.documentId, path: row.path }],
        author: ADA,
        base: await h.store.head(WORKSPACE),
      })
      await repos.documents.delete(row.documentId)
      await repos.sourcePaths.remove(WORKSPACE, row.path)
    }
    for (const document of await repos.documents.listByWorkspace(WORKSPACE)) {
      await repos.documents.update(document.id, { parentId: null }, NOW)
    }
    const current = await state(h)
    if (current?.layout == null || current.lastSyncedRevision === null) throw new Error('unsynced')
    await repos.sourceSyncState.recordSynced({
      workspaceId: WORKSPACE,
      revision: current.lastSyncedRevision,
      refused: current.refused,
      layout: {
        ...current.layout,
        fingerprint: current.layout.fingerprint.replace(',"tree":"folders"', ''),
      },
      brokenLinks: current.brokenLinks,
      now: NOW,
    })
  }

  it('re-maps a workspace synced before folders were documents, keeping every id and adding none twice', async () => {
    const h = harness([{ id: 'c1', files: GUIDE_FILES }])
    await h.sync()
    await asBeforeFolders(h)
    const files = Object.keys(GUIDE_FILES)
    const before = await Promise.all(files.map(async (path) => await h.idAt(path)))
    expect((await h.uow.repos.documents.listByWorkspace(WORKSPACE)).length).toBe(files.length)

    // No new revision of the source: the tree is placed again all the same.
    expect(await h.sync()).toEqual({ kind: 'synced', revision: 'c1', published: 1 })
    expect(await Promise.all(files.map(async (path) => await h.idAt(path)))).toEqual(before)
    const documents = await h.uow.repos.documents.listByWorkspace(WORKSPACE)
    expect(documents.length).toBe(files.length + 1)
    expect(new Set(documents.map(({ path }) => path)).size).toBe(documents.length)
    const concepts = await h.idAt(CONCEPTS)
    expect(await parentOf(h, CONCEPTS)).toBe(await h.idAt('docs/guide/README.md'))
    expect(await parentOf(h, 'docs/guide/concepts/tenancy/README.md')).toBe(concepts)
    expect(h.store.requests.at(-1)).toMatchObject({
      changeNote: LAYOUT_CHANGED_SUMMARY,
      changes: [expect.objectContaining({ kind: 'write', path: CONCEPTS })],
    })
    expect((await state(h))?.layout?.fingerprint).toContain('"tree":"folders"')

    // And once placed, it stays placed.
    expect(await h.sync()).toEqual({ kind: 'up-to-date', revision: 'c1' })
  })

  it('re-maps a manifest workspace on its next sync too', async () => {
    const files = {
      [MANIFEST]: manifest('{ slug: guide, title: Guide, path: docs/guide }'),
      'docs/guide/concepts/tenancy/README.md': '# Tenancy',
    }
    const h = harness([{ id: 'c1', files }])
    await h.sync()
    await asBeforeFolders(h)
    expect(await h.sync()).toMatchObject({ kind: 'synced', published: 1 })
    expect(await parentOf(h, 'docs/guide/concepts/tenancy/README.md')).toBe(await h.idAt(CONCEPTS))
  })
})
