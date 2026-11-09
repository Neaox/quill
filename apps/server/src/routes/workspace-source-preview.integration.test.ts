import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The preview of a source's settings (ADR-061), end to end: the real `git`
 * adapter fetches a bare repository built here into a directory of its own,
 * and the answer says what saving would place where — and nothing is
 * written, not a row, not an event, not a file in the sources' cache.
 * Saving afterwards places the files exactly where the preview said.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>
let root: string

interface Repository {
  readonly work: string
  readonly bare: string
  readonly remote: string
}

/** The fixture's own git, kept away from the machine's configuration. */
function git(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    ...(input === undefined ? {} : { input }),
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Ada Author',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Cy Committer',
      GIT_COMMITTER_EMAIL: 'cy@example.com',
      GIT_AUTHOR_DATE: '2025-12-30T00:00:00Z',
      GIT_COMMITTER_DATE: '2025-12-30T00:00:00Z',
    },
  }).trim()
}

async function createRepository(name: string): Promise<Repository> {
  const work = join(root, `${name}-work`)
  const bare = join(root, `${name}.git`)
  await mkdir(work)
  git(work, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  git(bare, ['config', 'uploadpack.allowFilter', 'true'])
  return { work, bare, remote: pathToFileURL(bare).href }
}

/**
 * Writes the files, adds the symbolic links straight to the index (so the
 * fixture needs no symlink support from the disk), commits and pushes.
 */
async function commit(
  repository: Repository,
  files: Readonly<Record<string, string | Uint8Array>>,
  links: Readonly<Record<string, string>> = {},
): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(repository.work, path)), { recursive: true })
    await writeFile(join(repository.work, path), content)
  }
  git(repository.work, ['add', '--all'])
  for (const [path, target] of Object.entries(links)) {
    const blob = git(repository.work, ['hash-object', '-w', '--stdin'], target)
    git(repository.work, ['update-index', '--add', '--cacheinfo', `120000,${blob},${path}`])
  }
  git(repository.work, ['commit', '--quiet', '--no-verify', '-m', 'Write the docs'])
  git(repository.work, ['push', '--quiet', repository.bare, 'HEAD:refs/heads/main'])
  return git(repository.work, ['rev-parse', 'HEAD'])
}

async function createWorkspace(slug: string): Promise<string> {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/workspaces',
    cookies: admin,
    payload: { unitId: tenancy.unitId, name: slug, slug },
  })
  expect(created.statusCode).toBe(201)
  return created.json<{ id: string }>().id
}

function preview(
  workspace: string,
  payload: Record<string, unknown>,
  cookies: Record<string, string> = admin,
) {
  return harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspace}/source/preview`,
    cookies,
    payload: { branch: 'main', credential: null, collections: [], ...payload },
  })
}

interface PreviewNode {
  readonly path: string
  readonly title: string
  readonly kind: string
  readonly change: string | null
  readonly depth: number
}

interface PreviewBody {
  readonly outcome: 'preview'
  readonly preview: {
    readonly revision: string
    readonly manifest: Record<string, unknown>
    readonly origin: string | null
    readonly collections: readonly {
      readonly slug: string
      readonly title: string
      readonly status: string
      readonly nodes: readonly PreviewNode[]
    }[]
    readonly skipped: readonly { readonly reason: string; readonly paths: readonly string[] }[]
    readonly assets: number
    readonly changes: Record<string, unknown> | null
  }
}

async function previewed(workspace: string, payload: Record<string, unknown>) {
  const response = await preview(workspace, payload)
  expect(response.statusCode).toBe(200)
  const body = response.json<PreviewBody>()
  expect(body.outcome).toBe('preview')
  return body.preview
}

/** A collection's nodes as indented `title [kind]` lines. */
function outline(nodes: readonly PreviewNode[]): string[] {
  return nodes.map(
    ({ depth, title, kind, change }) =>
      `${'  '.repeat(depth)}${title} [${kind}${change === null ? '' : `, ${change}`}]`,
  )
}

/** How many rows each table that a source could touch holds, and what the sources' cache holds. */
async function footprint(): Promise<Record<string, unknown>> {
  const tables = [
    'workspaces',
    'workspace_sources',
    'collections',
    'documents',
    'source_path_map',
    'source_sync_state',
    'revisions_index',
    'attachments',
    'secrets',
    'audit_events',
    'outbox_events',
  ]
  const counts: Record<string, unknown> = {}
  for (const table of tables) {
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- a handful of counts, in order
    const { rows } = await harness.database.pool.query<{ count: string }>(
      `SELECT count(*) FROM ${table}`,
    )
    counts[table] = rows[0]?.count
  }
  counts['cache'] = (await readdir(harness.sourceCacheRoot)).toSorted()
  return counts
}

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  root = await mkdtemp(join(tmpdir(), 'quill-source-preview-'))
}, 60_000)

afterAll(async () => {
  await harness.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

describe('previewing a repository before connecting it', () => {
  let repository: Repository
  let workspace: string
  let head: string

  const manifest = [
    'version: 1',
    'workspaces:',
    '  - slug: internal',
    '    collections: [{ slug: everything, title: Everything, path: docs }]',
    '  - slug: public',
    '    collections:',
    '      - { slug: guides, title: Guides, path: docs/guides }',
    '      - { slug: decisions, title: Decisions, path: docs/adr, order: filename }',
    '    exclude: [docs/guides/drafts]',
    '    owner: docs-team',
    '',
  ].join('\n')

  beforeAll(async () => {
    repository = await createRepository('several')
    head = await commit(
      repository,
      {
        '.quill/workspace.yaml': manifest,
        'docs/guides/README.md': '# Guides\n',
        'docs/guides/setup.md': '# Setting up\n',
        'docs/guides/deploy/aws.md': '# On AWS\n',
        'docs/guides/drafts/wip.md': '# Not ready\n',
        'docs/guides/legacy.md': new Uint8Array([0x23, 0x20, 0xff, 0xfe]),
        'docs/guides/notes.txt': 'not a page\n',
        'docs/adr/0002-second.md': '# Second decision\n',
        'docs/adr/0001-first.md': '# First decision\n',
        'internal/salaries.md': '# Never fetched\n',
      },
      { 'docs/guides/elsewhere.md': '../../internal/salaries.md' },
    )
    workspace = await createWorkspace('handbook')
  })

  it('is for instance administrators only', async () => {
    expect((await preview(workspace, { remote: repository.remote }, editor)).statusCode).toBe(403)
    expect((await preview(workspace, { remote: repository.remote }, viewer)).statusCode).toBe(403)
  })

  it('refuses settings that saving would refuse, naming the setting', async () => {
    const http = await preview(workspace, { remote: 'http://example.com/docs.git' })
    expect(http.statusCode).toBe(422)
    expect(http.json()).toMatchObject({
      error: { code: 'invalid_source', details: { field: 'remote' } },
    })
    const secret = await preview(workspace, {
      remote: repository.remote,
      credential: { username: 'x-access-token', secretName: 'sources/missing' },
    })
    expect(secret.json()).toMatchObject({ error: { details: { field: 'credential' } } })
  })

  it('lists the workspaces the manifest describes when none is this one', async () => {
    const result = await previewed(workspace, { remote: repository.remote })
    expect(result.revision).toBe(head)
    expect(result.manifest).toMatchObject({
      state: 'problem',
      entries: [
        { slug: 'internal', collections: 1 },
        { slug: 'public', collections: 2 },
      ],
      problem: { message: expect.stringContaining('none has the slug "handbook"') },
    })
    expect(result.collections).toEqual([])
  })

  it('previews the entry chosen: its collections, its tree, and what it leaves out', async () => {
    const before = await footprint()
    const result = await previewed(workspace, {
      remote: repository.remote,
      manifestEntry: 'public',
    })

    expect(result.manifest).toMatchObject({
      state: 'read',
      entry: 'public',
      unknownKeys: [{ key: 'workspaces[1].owner', line: 10 }],
    })
    expect(result.origin).toBe('manifest')
    expect(result.collections.map(({ slug, title, status }) => [slug, title, status])).toEqual([
      ['guides', 'Guides', 'new'],
      ['decisions', 'Decisions', 'new'],
    ])
    expect(outline(result.collections[0]?.nodes ?? [])).toEqual([
      'Guides [document]',
      'Deploy [generated-folder]',
      '  On AWS [document]',
      'Setting up [document]',
    ])
    expect(outline(result.collections[1]?.nodes ?? [])).toEqual([
      'First decision [document]',
      'Second decision [document]',
    ])
    expect(Object.fromEntries(result.skipped.map(({ reason, paths }) => [reason, paths]))).toEqual({
      excluded: ['docs/guides/drafts/wip.md'],
      'not-utf8': ['docs/guides/legacy.md'],
      'symbolic-link': ['docs/guides/elsewhere.md'],
      'not-markdown': ['docs/guides/notes.txt'],
    })
    expect(result.changes).toBeNull()

    // Nothing written: no row, no event, no audit entry, nothing left in the cache.
    expect(await footprint()).toEqual(before)
    const origin = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace}`,
      cookies: admin,
    })
    expect(origin.json()).toMatchObject({ origin: { kind: 'native' } })
  })

  it('answers a branch that is not there, and an address that leads nowhere, as such', async () => {
    const branch = await preview(workspace, { remote: repository.remote, branch: 'mian' })
    expect(branch.statusCode).toBe(200)
    expect(branch.json()).toMatchObject({ outcome: 'unreadable', reason: 'branch-not-found' })

    const nowhere = await preview(workspace, {
      remote: pathToFileURL(join(root, 'no-such-repository.git')).href,
    })
    expect(nowhere.json()).toMatchObject({ outcome: 'unreadable', reason: 'unreachable' })
    expect(await readdir(harness.sourceCacheRoot)).toEqual([])
  })

  it('saves the entry it previewed, and the sync places the files where the preview said', async () => {
    const saved = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
      payload: {
        remote: repository.remote,
        branch: 'main',
        collections: [],
        manifestEntry: 'public',
        history: 'head',
        commitMessages: 'subject',
        credential: null,
      },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({ manifestEntry: 'public', collections: [] })
    await harness.drainOutbox()

    const tree = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace}/tree`,
      cookies: admin,
    })
    interface Node {
      readonly title: string
      readonly children: readonly Node[]
    }
    const lines = (nodes: readonly Node[], depth = 0): string[] =>
      nodes.flatMap((node) => [
        `${'  '.repeat(depth)}${node.title}`,
        ...lines(node.children, depth + 1),
      ])
    const collections = tree.json<{
      collections: readonly { slug: string; documents: readonly Node[] }[]
    }>().collections
    expect(collections.map(({ slug }) => slug).toSorted()).toEqual(['decisions', 'guides'])
    const guides = collections.find(({ slug }) => slug === 'guides')
    expect(lines(guides?.documents ?? [])).toEqual(['Guides', 'Deploy', '  On AWS', 'Setting up'])
  })
})

describe('previewing a change to a source already connected', () => {
  let repository: Repository
  let workspace: string

  beforeAll(async () => {
    repository = await createRepository('edit')
    await commit(repository, {
      'docs/guides/a.md': '# Alpha\n',
      'docs/guides/old/b.md': '# Beta\n',
      'docs/adr/0001.md': '# Decision\n',
    })
    workspace = await createWorkspace('editing')
    const saved = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
      payload: {
        remote: repository.remote,
        branch: 'main',
        collections: [
          { slug: 'guides', name: 'Guides', path: 'docs/guides' },
          { slug: 'decisions', name: 'Decisions', path: 'docs/adr' },
        ],
        history: 'full',
        commitMessages: 'subject',
        credential: null,
      },
    })
    expect(saved.statusCode).toBe(200)
    await harness.drainOutbox()
  })

  it('says what saving would add, move and archive, and writes nothing', async () => {
    await commit(repository, { 'docs/guides/new.md': '# New page\n' })
    const before = await footprint()

    const result = await previewed(workspace, {
      remote: repository.remote,
      collections: [{ slug: 'guides', name: 'Handbook', path: 'docs' }],
    })

    expect(result.collections.map(({ slug, status }) => [slug, status])).toEqual([
      ['guides', 'renamed'],
    ])
    expect(outline(result.collections[0]?.nodes ?? [])).toEqual([
      'Adr [generated-folder, added]',
      '  Decision [document, moved]',
      'Guides [generated-folder, added]',
      '  Alpha [document, unchanged]',
      '  New page [document, added]',
      '  Old [generated-folder, unchanged]',
      '    Beta [document, unchanged]',
    ])
    expect(result.changes).toEqual({
      added: 3,
      moved: 1,
      unchanged: 3,
      archived: [],
      retired: [],
    })
    expect(await footprint()).toEqual(before)
  })

  it('names what saving would archive', async () => {
    const result = await previewed(workspace, {
      remote: repository.remote,
      collections: [{ slug: 'guides', name: 'Guides', path: 'docs/guides' }],
    })
    expect(result.changes).toMatchObject({
      archived: [{ path: 'docs/adr/0001.md', title: 'Decision' }],
    })
  })

  it('saves the change, and the sync moves what the preview said it would', async () => {
    const saved = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
      payload: {
        remote: repository.remote,
        branch: 'main',
        collections: [{ slug: 'guides', name: 'Handbook', path: 'docs' }],
        history: 'full',
        commitMessages: 'subject',
        credential: null,
      },
    })
    expect(saved.statusCode).toBe(200)
    await harness.drainOutbox()

    const after = await previewed(workspace, {
      remote: repository.remote,
      collections: [{ slug: 'guides', name: 'Handbook', path: 'docs' }],
    })
    // Saved and synced, the same settings change nothing more.
    expect(after.changes).toEqual({
      added: 0,
      moved: 0,
      unchanged: 7,
      archived: [],
      retired: [],
    })
    expect(after.collections[0]?.status).toBe('kept')
  })
})
