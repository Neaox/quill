import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'

import { ExternalSourceError } from '../ports/external-source.ts'
import type { ExternalSourceProvider, SourceDraft } from '../ports/source-sync.ts'
import { FakeSource } from '../test-support/fake-external-source.ts'
import type { Commit } from '../test-support/fake-external-source.ts'
import {
  aShortId,
  createFakeClock,
  createFakeContentStore,
  createFakeDocumentFormat,
  createFakeIdGenerator,
  createInMemoryBlobStore,
  createInMemoryUnitOfWork,
} from '../test-support/index.ts'
import type { InMemoryUnitOfWork } from '../test-support/index.ts'
import { previewWorkspaceSource } from './source-preview.ts'
import type {
  SourcePreview,
  SourcePreviewCommand,
  SourcePreviewNode,
  SourcePreviewResult,
} from './source-preview.ts'
import { syncSource } from './sync-source.ts'
import { configureWorkspaceSource } from './workspace-source.ts'

const NOW = new Date('2026-06-01T12:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const MANIFEST = '.quill/workspace.yaml'

let uow: InMemoryUnitOfWork
let source: FakeSource
let drafts: SourceDraft[]
let opened: number
let closed: number

function provider(): ExternalSourceProvider {
  return {
    forWorkspace: async () => ({
      source,
      settings: await settingsOf(),
      configuredAt: new Date(0),
    }),
    async withDraft(draft, work) {
      drafts.push(draft)
      opened += 1
      try {
        return await work(source)
      } finally {
        closed += 1
      }
    },
  }
}

async function settingsOf() {
  const row = await uow.repos.workspaceSources.find(WORKSPACE)
  if (row === null) throw new Error('not sourced')
  return row
}

function command(overrides: Partial<SourcePreviewCommand> = {}): SourcePreviewCommand {
  return {
    workspaceId: WORKSPACE,
    remote: 'https://github.com/acme/handbook.git',
    branch: 'main',
    credential: null,
    collections: [],
    ...overrides,
  }
}

async function preview(
  overrides: Partial<SourcePreviewCommand> = {},
): Promise<SourcePreviewResult> {
  return await previewWorkspaceSource(
    { uow, sources: provider(), format: createFakeDocumentFormat() },
    command(overrides),
  )
}

async function previewed(overrides: Partial<SourcePreviewCommand> = {}): Promise<SourcePreview> {
  const result = await preview(overrides)
  if (result.kind !== 'preview') throw new Error(`unexpected result: ${JSON.stringify(result)}`)
  return result.preview
}

/** A tree as `title (kind, change)` lines, indented by depth: easy to read in a failure. */
function outline(nodes: readonly SourcePreviewNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.title} [${node.kind}${node.change === null ? '' : `, ${node.change}`}] ${node.path}`,
    ...outline(node.children, depth + 1),
  ])
}

function at(commits: readonly Commit[]): void {
  source = new FakeSource(commits)
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  drafts = []
  opened = 0
  closed = 0
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Handbook',
    slug: 'handbook',
    now: NOW,
  })
})

describe('previewWorkspaceSource, without a manifest', () => {
  it('places the files under the settings’ paths, folders as documents, as the sync would', async () => {
    at([
      {
        id: 'c1',
        files: {
          'docs/guides/README.md': '# Guides overview',
          'docs/guides/setup.md': '# Setting up',
          'docs/guides/deploy/index.md': '# Deploying',
          'docs/guides/deploy/aws.md': '# On AWS',
          'docs/guides/concepts/tenancy.md': '# Tenancy',
          'docs/guides/diagram.png': 'png',
          'docs/guides/notes.txt': 'notes',
          'src/main.ts': 'code',
        },
      },
    ])
    const result = await previewed({
      collections: [{ slug: 'guides', name: 'Guides', path: 'docs/guides' }],
    })

    expect(result.manifest).toMatchObject({ state: 'absent', entries: [] })
    expect(result.origin).toBe('settings')
    expect(result.collections).toHaveLength(1)
    const [guides] = result.collections
    expect(guides).toMatchObject({ slug: 'guides', title: 'Guides', status: 'new', documents: 6 })
    expect(outline(guides?.tree ?? [])).toEqual([
      'Guides overview [document] docs/guides/README.md',
      'Concepts [generated-folder] docs/guides/concepts',
      '  Tenancy [document] docs/guides/concepts/tenancy.md',
      'Deploying [folder] docs/guides/deploy/index.md',
      '  On AWS [document] docs/guides/deploy/aws.md',
      'Setting up [document] docs/guides/setup.md',
    ])
    expect(result.assets).toBe(1)
    expect(result.skipped).toEqual([
      expect.objectContaining({
        reason: 'not-markdown',
        count: 1,
        paths: ['docs/guides/notes.txt'],
      }),
    ])
    expect(result.changes).toBeNull()
    expect(result.limits).toEqual({ files: 7, truncated: false, unread: 0 })
    // The source's own narrowing, from the settings' paths: nothing else was fetched.
    expect(source.narrowed).toEqual([[MANIFEST, 'docs/guides']])
  })

  it('places nothing without a manifest or a collection, and says so', async () => {
    at([{ id: 'c1', files: { 'docs/a.md': '# A' } }])
    const result = await previewed()
    expect(result.manifest.state).toBe('absent')
    expect(result.collections).toEqual([])
  })
})

describe('previewWorkspaceSource, with a manifest', () => {
  const several = [
    'version: 1',
    'workspaces:',
    '  - slug: internal',
    '    collections: [{ slug: all, title: Everything, path: docs }]',
    '  - slug: public',
    '    collections:',
    '      - { slug: guides, title: Guides, path: docs/guides }',
    '      - { slug: adr, title: Decisions, path: docs/adr, order: filename }',
    '    exclude: [docs/guides/drafts]',
  ].join('\n')

  it('lists the workspaces a manifest describes, and asks which when none is its own', async () => {
    at([{ id: 'c1', files: { [MANIFEST]: several, 'docs/guides/a.md': '# A' } }])
    const result = await previewed()
    expect(result.manifest).toMatchObject({
      state: 'problem',
      entries: [
        { slug: 'internal', collections: 1 },
        { slug: 'public', collections: 2 },
      ],
      entry: null,
      problem: { line: null, message: expect.stringContaining('none has the slug "handbook"') },
    })
    expect(result.origin).toBeNull()
    expect(result.collections).toEqual([])
  })

  it('reads the entry chosen, and says what it leaves out and why', async () => {
    at([
      {
        id: 'c1',
        files: {
          [MANIFEST]: several,
          'docs/guides/a.md': '# A',
          'docs/guides/drafts/wip.md': '# Work in progress',
          'docs/guides/huge.md': { kind: 'too-large' },
          'docs/guides/latin1.md': { kind: 'bytes', bytes: new Uint8Array([0xff, 0xfe]) },
          'docs/guides/link.md': { kind: 'symbolic-link', target: '../../README.md' },
          'docs/adr/0002-b.md': '# Second',
          'docs/adr/0001-a.md': '# First',
          'docs/private/secret.md': '# Not here',
        },
      },
    ])
    const result = await previewed({ manifestEntry: 'public' })
    expect(result.manifest).toMatchObject({ state: 'read', entry: 'public', problem: null })
    expect(result.origin).toBe('manifest')
    expect(
      result.collections.map(({ slug, title, documents }) => [slug, title, documents]),
    ).toEqual([
      ['guides', 'Guides', 1],
      ['adr', 'Decisions', 2],
    ])
    expect(outline(result.collections[1]?.tree ?? [])).toEqual([
      'First [document] docs/adr/0001-a.md',
      'Second [document] docs/adr/0002-b.md',
    ])
    const skipped = Object.fromEntries(result.skipped.map(({ reason, paths }) => [reason, paths]))
    expect(skipped).toEqual({
      excluded: ['docs/guides/drafts/wip.md'],
      'too-large': ['docs/guides/huge.md'],
      'not-utf8': ['docs/guides/latin1.md'],
      'symbolic-link': ['docs/guides/link.md'],
    })
    expect(result.skipped.find(({ reason }) => reason === 'excluded')?.patterns).toEqual({
      'docs/guides/drafts/wip.md': 'docs/guides/drafts',
    })
    // The private folder is outside every path, so it was never even listed.
    expect(source.narrowed).toEqual([[MANIFEST, 'docs/guides', 'docs/adr']])
  })

  it('says which files a glob leaves out of the folder it widens to', async () => {
    at([
      {
        id: 'c1',
        files: {
          [MANIFEST]:
            'version: 1\ncollections:\n  - { slug: p, title: Packages, path: "packages/**/README.md" }\n',
          'packages/ui/README.md': '# UI',
          'packages/ui/CHANGELOG.md': '# Changes',
        },
      },
    ])
    const result = await previewed()
    expect(outline(result.collections[0]?.tree ?? [])).toEqual([
      'UI [folder] packages/ui/README.md',
    ])
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: 'outside', paths: ['packages/ui/CHANGELOG.md'] }),
    ])
  })

  it('reports a manifest that does not read with its line, and places nothing', async () => {
    at([
      {
        id: 'c1',
        files: {
          [MANIFEST]: 'version: 1\ncollections:\n  - { slug: g, title: G, path: "**/*.md" }\n',
          'docs/a.md': '# A',
        },
      },
    ])
    const result = await previewed()
    expect(result.manifest).toMatchObject({
      state: 'problem',
      problem: { line: 3, message: expect.stringContaining('no directory') },
    })
    expect(result.collections).toEqual([])
  })

  it('keeps the manifest’s unknown keys, with their lines', async () => {
    at([
      {
        id: 'c1',
        files: {
          [MANIFEST]:
            'version: 1\nowner: docs-team\ncollections:\n  - { slug: g, title: G, path: docs }\n',
          'docs/a.md': '# A',
        },
      },
    ])
    expect((await previewed()).manifest.unknownKeys).toEqual([{ key: 'owner', line: 2 }])
  })
})

describe('previewWorkspaceSource, refusals and failures', () => {
  beforeEach(() => {
    at([{ id: 'c1', files: { 'docs/a.md': '# A' } }])
  })

  it('refuses settings saving would refuse, before opening anything', async () => {
    expect(await preview({ remote: 'http://github.com/acme/handbook.git' })).toMatchObject({
      kind: 'invalid',
      field: 'remote',
    })
    expect(
      await preview({ credential: { username: 'x-access-token', secretName: 'sources/none' } }),
    ).toMatchObject({
      kind: 'invalid',
      field: 'credential',
      message: expect.stringContaining('No secret'),
    })
    expect(await preview({ manifestEntry: 'Not A Slug' })).toMatchObject({
      kind: 'invalid',
      field: 'manifestEntry',
    })
    expect(opened).toBe(0)
  })

  it('refuses a native workspace that holds documents', async () => {
    await uow.repos.documents.create({
      id: documentId('00000000-0000-4000-8000-000000000201'),
      shortId: aShortId(),
      workspaceId: WORKSPACE,
      collectionId: null,
      parentId: null,
      slug: 'a',
      path: 'a.md',
      title: 'A',
      status: 'published',
      templateId: null,
      templateVersion: null,
      createdBy: null,
      now: NOW,
    })
    expect(await preview()).toEqual({ kind: 'not-empty' })
    expect(opened).toBe(0)
  })

  it('answers not found for a workspace that is not there', async () => {
    expect(
      await previewWorkspaceSource(
        { uow, sources: provider(), format: createFakeDocumentFormat() },
        command({ workspaceId: workspaceId('00000000-0000-4000-8000-000000000999') }),
      ),
    ).toEqual({ kind: 'not-found' })
  })

  it.each([
    [
      new ExternalSourceError('branch-not-found', 'The remote has no branch "mian".'),
      'branch-not-found',
    ],
    [
      new ExternalSourceError(
        'command-failed',
        "git ls-remote failed (exit 128): fatal: Authentication failed for 'https://github.com/acme/handbook.git/'",
      ),
      'credential-refused',
    ],
    [
      new ExternalSourceError(
        'command-failed',
        "git ls-remote failed (exit 128): fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      ),
      'credential-refused',
    ],
    [
      new ExternalSourceError(
        'command-failed',
        "git ls-remote failed (exit 128): fatal: unable to access 'https://nowhere.invalid/x.git/': Could not resolve host: nowhere.invalid",
      ),
      'unreachable',
    ],
    [
      new ExternalSourceError('blocked-by-outbound-policy', 'Requests to 10.0.0.1 are refused'),
      'blocked-by-outbound-policy',
    ],
    [
      new ExternalSourceError(
        'blocked-by-outbound-policy',
        'Requests to nowhere.invalid are refused: Error: getaddrinfo ENOTFOUND nowhere.invalid',
      ),
      'unreachable',
    ],
    [new ExternalSourceError('timeout', 'the fetch did not finish'), 'timeout'],
    [
      new ExternalSourceError('command-failed', 'git fetch failed (exit 1): something odd'),
      'command-failed',
    ],
  ])('answers why the repository could not be read: %s', async (error, reason) => {
    source.fetchFailure = error
    expect(await preview({ collections: [{ slug: 'g', name: 'G', path: 'docs' }] })).toEqual({
      kind: 'unreadable',
      reason,
      message: error.message,
    })
    // The draft's directory is gone whatever happened.
    expect(closed).toBe(opened)
  })

  it('opens the draft it was given, and writes nothing', async () => {
    await uow.repos.secrets.put({
      name: 'sources/handbook',
      ciphertext: 'sealed',
      wrappedKey: 'wrapped',
      keyId: 'k1',
      now: NOW,
    })
    const before = JSON.stringify({
      events: uow.events,
      audit: uow.auditEvents,
      collections: await uow.repos.collections.listByWorkspace(WORKSPACE),
      source: await uow.repos.workspaceSources.find(WORKSPACE),
    })
    const credential = { username: 'x-access-token', secretName: 'sources/handbook' }
    await previewed({ credential, collections: [{ slug: 'g', name: 'G', path: 'docs' }] })

    expect(drafts).toEqual([
      {
        remote: 'https://github.com/acme/handbook.git',
        branch: 'main',
        credential,
        manifestPath: null,
      },
    ])
    expect(
      JSON.stringify({
        events: uow.events,
        audit: uow.auditEvents,
        collections: await uow.repos.collections.listByWorkspace(WORKSPACE),
        source: await uow.repos.workspaceSources.find(WORKSPACE),
      }),
    ).toBe(before)
    expect((await uow.repos.workspaces.findById(WORKSPACE))?.origin.kind).toBe('native')
  })
})

describe('previewWorkspaceSource, for a workspace already read from a repository', () => {
  it('says what saving would add, move and archive, against what is stored', async () => {
    at([
      {
        id: 'c1',
        files: {
          'docs/guides/a.md': '# A',
          'docs/guides/old/b.md': '# B',
          'docs/adr/0001.md': '# Decision',
        },
      },
    ])
    const clock = createFakeClock(NOW)
    const ids = createFakeIdGenerator('aaaa')
    const configured = await configureWorkspaceSource(
      { uow, clock, ids },
      {
        workspaceId: WORKSPACE,
        remote: 'https://github.com/acme/handbook.git',
        branch: 'main',
        collections: [
          { slug: 'guides', name: 'Guides', path: 'docs/guides' },
          { slug: 'adr', name: 'Decisions', path: 'docs/adr' },
        ],
        history: 'full',
        commitMessages: 'subject',
        credential: null,
        configuredBy: userId('00000000-0000-4000-8000-000000000001'),
      },
    )
    expect(configured.kind).toBe('configured')
    const synced = await syncSource(
      {
        uow,
        contentStore: createFakeContentStore({ now: () => clock.now() }),
        format: createFakeDocumentFormat(),
        sources: provider(),
        lock: {
          withLock: async (_id, work) => ({ kind: 'ran', value: await work() }),
          isHeld: async () => false,
        },
        clock,
        ids,
        blobStore: createInMemoryBlobStore(),
        drawingText: { read: async () => null },
        maxAssetBytes: 1024 * 1024,
      },
      { workspaceId: WORKSPACE },
    )
    expect(synced.kind).toBe('synced')
    source.push({
      id: 'c2',
      files: {
        'docs/guides/a.md': '# A',
        'docs/guides/old/b.md': '# B',
        'docs/guides/new.md': '# New',
        'docs/adr/0001.md': '# Decision',
      },
    })

    // The decisions now go in with the guides, under a new name for the guides.
    const result = await previewed({
      collections: [{ slug: 'guides', name: 'Handbook', path: 'docs' }],
    })

    expect(
      result.collections.map(({ slug, status, previousTitle }) => [slug, status, previousTitle]),
    ).toEqual([['guides', 'renamed', 'Guides']])
    expect(outline(result.collections[0]?.tree ?? [])).toEqual([
      'Adr [generated-folder, added] docs/adr',
      '  Decision [document, moved] docs/adr/0001.md',
      'Guides [generated-folder, added] docs/guides',
      '  A [document, unchanged] docs/guides/a.md',
      '  New [document, added] docs/guides/new.md',
      '  Old [generated-folder, unchanged] docs/guides/old',
      '    B [document, unchanged] docs/guides/old/b.md',
    ])
    expect(result.changes).toEqual({
      added: 3,
      moved: 1,
      unchanged: 3,
      archived: [],
      retired: [],
    })

    // Narrowed to the guides alone: the decisions leave.
    const narrower = await previewed({
      collections: [{ slug: 'guides', name: 'Guides', path: 'docs/guides' }],
    })
    expect(narrower.changes?.archived).toEqual([{ path: 'docs/adr/0001.md', title: 'Decision' }])
  })
})

describe('previewWorkspaceSource, at its limits and edges', () => {
  it('stops listing at its file limit and reading at its byte limit, and says so', async () => {
    at([
      {
        id: 'c1',
        files: {
          'docs/a.md': `# A\n${'x'.repeat(40)}`,
          'docs/b.md': 'No heading, so the title comes from the file name.',
          'docs/c.md': '# C',
          'docs/d.md': '# D',
        },
      },
    ])
    const result = await previewWorkspaceSource(
      {
        uow,
        sources: provider(),
        format: createFakeDocumentFormat(),
        limits: { files: 3, readBytes: 10 },
      },
      command({ collections: [{ slug: 'docs', name: 'Docs', path: 'docs' }] }),
    )
    if (result.kind !== 'preview') throw new Error(result.kind)
    expect(result.preview.limits).toEqual({ files: 3, truncated: true, unread: 2 })
    expect(outline(result.preview.collections[0]?.tree ?? [])).toEqual([
      'A [document] docs/a.md',
      'B [document] docs/b.md',
      'C [document] docs/c.md',
    ])
  })

  it('lists other files a layout leaves out, and ignores a file at a folder page’s own path', async () => {
    at([
      {
        id: 'c1',
        files: {
          [MANIFEST]: [
            'version: 1',
            'collections:',
            '  - { slug: p, title: Packages, path: "packages/**/README.md" }',
            'exclude: [packages/old]',
          ].join('\n'),
          'packages/ui/README.md': '# UI',
          'packages/ui/build.log': 'log',
          'packages/old/README.md': '# Old',
          'packages/old/notes.txt': 'notes',
          'packages/ui/.quill/folder.md': '# Claims the folder',
        },
      },
    ])
    const result = await previewed()
    expect(Object.fromEntries(result.skipped.map(({ reason, paths }) => [reason, paths]))).toEqual({
      outside: ['packages/ui/build.log'],
      excluded: ['packages/old/notes.txt', 'packages/old/README.md'],
    })
    expect(outline(result.collections[0]?.tree ?? [])).toEqual([
      'UI [folder] packages/ui/README.md',
    ])
  })

  it('names a page with no title of its own after its file', async () => {
    at([{ id: 'c1', files: { 'docs/release-notes.md': 'Just words, no heading.' } }])
    const result = await previewed({ collections: [{ slug: 'docs', name: 'Docs', path: 'docs' }] })
    expect(outline(result.collections[0]?.tree ?? [])).toEqual([
      'Release notes [document] docs/release-notes.md',
    ])
  })

  it('passes on a failure that is not the repository’s', async () => {
    at([{ id: 'c1', files: {} }])
    source.fetchFailure = new Error('The disk is full')
    await expect(preview()).rejects.toThrow('The disk is full')
    expect(closed).toBe(opened)
  })
})

describe('previewWorkspaceSource, against what a sync left', () => {
  const clock = () => createFakeClock(NOW)

  async function connect(settings: {
    collections?: { slug: string; name: string; path: string }[]
    manifestEntry?: string | null
  }) {
    const time = clock()
    const ids = createFakeIdGenerator('bbbb')
    const configured = await configureWorkspaceSource(
      { uow, clock: time, ids },
      {
        workspaceId: WORKSPACE,
        remote: 'https://github.com/acme/handbook.git',
        branch: 'main',
        collections: settings.collections ?? [],
        manifestEntry: settings.manifestEntry ?? null,
        history: 'full',
        commitMessages: 'subject',
        credential: null,
        configuredBy: userId('00000000-0000-4000-8000-000000000001'),
      },
    )
    expect(configured.kind).toBe('configured')
    return async () =>
      await syncSource(
        {
          uow,
          contentStore: createFakeContentStore({ now: () => time.now() }),
          format: createFakeDocumentFormat(),
          sources: provider(),
          lock: {
            withLock: async (_id, work) => ({ kind: 'ran', value: await work() }),
            isHeld: async () => false,
          },
          clock: time,
          ids,
          blobStore: createInMemoryBlobStore(),
          drawingText: { read: async () => null },
          maxAssetBytes: 1024 * 1024,
        },
        { workspaceId: WORKSPACE },
      )
  }

  it('says what a source never synced would add, and one whose sync failed', async () => {
    at([{ id: 'c1', files: { 'docs/a.md': '# A' } }])
    const sync = await connect({ collections: [{ slug: 'docs', name: 'Docs', path: 'docs' }] })
    const before = await previewed({ collections: [{ slug: 'docs', name: 'Docs', path: 'docs' }] })
    expect(before.changes).toEqual({ added: 1, moved: 0, unchanged: 0, archived: [], retired: [] })

    source.fetchFailure = new ExternalSourceError('timeout', 'too slow')
    expect((await sync()).kind).toBe('failed')
    source.fetchFailure = null
    const failed = await previewed({ collections: [{ slug: 'docs', name: 'Docs', path: 'docs' }] })
    expect(failed.collections[0]?.status).toBe('kept')
    expect(failed.changes?.added).toBe(1)
  })

  it('keeps a folder’s page when it changes kind, and names what leaves and what retires', async () => {
    const manifest = [
      'version: 1',
      'workspaces:',
      '  - slug: handbook',
      '    collections:',
      '      - { slug: guides, title: Guides, path: docs/guides }',
      '      - { slug: notes, title: Notes, path: docs/notes }',
      '  - slug: slim',
      '    collections: [{ slug: guides, title: Guides, path: docs/guides }]',
    ].join('\n')
    at([
      {
        id: 'c1',
        files: {
          [MANIFEST]: manifest,
          'docs/guides/old/b.md': '# B',
          'docs/guides/deploy/README.md': '# Deploying',
          'docs/guides/deploy/aws.md': '# AWS',
          'docs/guides/gone.md': '# Gone',
          'docs/notes/m.md': '# Memo',
          'docs/notes/n.md': '# Note',
        },
      },
    ])
    const sync = await connect({})
    expect((await sync()).kind).toBe('synced')
    // The old folder gains a README; the deploy folder loses its own.
    source.push({
      id: 'c2',
      files: {
        [MANIFEST]: manifest,
        'docs/guides/old/README.md': '# Old things',
        'docs/guides/old/b.md': '# B',
        'docs/guides/deploy/aws.md': '# AWS',
        'docs/notes/m.md': '# Memo',
        'docs/notes/n.md': '# Note',
      },
    })

    const same = await previewed()
    expect(outline(same.collections[0]?.tree ?? [])).toEqual([
      'Deploy [generated-folder, unchanged] docs/guides/deploy',
      '  AWS [document, unchanged] docs/guides/deploy/aws.md',
      'Old things [folder, unchanged] docs/guides/old/README.md',
      '  B [document, unchanged] docs/guides/old/b.md',
    ])
    expect(same.changes).toMatchObject({
      added: 0,
      moved: 0,
      archived: [{ path: 'docs/guides/gone.md', title: 'Gone' }],
      retired: [],
    })
    // Synced, the same settings change nothing, and what left stays left.
    expect((await sync()).kind).toBe('synced')
    expect((await previewed()).changes).toMatchObject({ added: 0, moved: 0, archived: [] })

    const slim = await previewed({ manifestEntry: 'slim' })
    expect(slim.changes).toMatchObject({
      archived: [
        { path: 'docs/notes/m.md', title: 'Memo' },
        { path: 'docs/notes/n.md', title: 'Note' },
      ],
      retired: [{ slug: 'notes', title: 'Notes' }],
    })
  })
})
