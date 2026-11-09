import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createGrant } from '@quill/application'
import type { DocumentId } from '@quill/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * A workspace read from a repository, end to end (ADR-061): an administrator
 * configures the source through the API, the sync job — the real `git`
 * adapter, the real advisory lock, the real outbox lane — replays a bare
 * repository built here with the `git` CLI, and "Sync now" brings a later
 * push in. Nothing a person does writes the workspace afterwards.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>
let root: string
let work: string
let bare: string

/** The fixture's own git, kept away from the machine's configuration (signing, hooks, templates). */
function git(cwd: string, args: readonly string[], committedAt = '2025-12-30T00:00:00Z'): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Ada Author',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Cy Committer',
      GIT_COMMITTER_EMAIL: 'cy@example.com',
      // Before the harness's clock, so no revision is stamped as from the future.
      GIT_AUTHOR_DATE: committedAt,
      GIT_COMMITTER_DATE: committedAt,
    },
  }).trim()
}

/** Writes the files, commits them, and pushes to the bare repository; answers the commit. */
async function commit(
  message: string,
  files: Readonly<Record<string, string>>,
  committedAt?: string,
): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(work, path)), { recursive: true })
    await writeFile(join(work, path), content)
  }
  git(work, ['add', '--all'])
  git(work, ['commit', '--quiet', '--no-verify', '-m', message], committedAt)
  git(work, ['push', '--quiet', bare, 'HEAD:refs/heads/main'])
  return git(work, ['rev-parse', 'HEAD'])
}

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)

  root = await mkdtemp(join(tmpdir(), 'quill-source-route-'))
  work = join(root, 'work')
  bare = join(root, 'handbook.git')
  await mkdir(work)
  git(work, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  // What a forge allows: partial clone filters.
  git(bare, ['config', 'uploadpack.allowFilter', 'true'])
}, 60_000)

afterAll(async () => {
  await harness.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

function configure(cookies: Record<string, string>, payload: Record<string, unknown> = {}) {
  return harness.app.inject({
    method: 'PUT',
    url: `/api/workspaces/${tenancy.workspaceId}/source`,
    cookies,
    payload: {
      remote: pathToFileURL(bare).href,
      branch: 'main',
      collections: [{ slug: 'guides', name: 'Guides', path: 'docs/guides' }],
      history: 'full',
      commitMessages: 'subject',
      credential: null,
      ...payload,
    },
  })
}

function source(cookies = admin) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${tenancy.workspaceId}/source`,
    cookies,
  })
}

function syncNow(cookies = admin, workspace: string = tenancy.workspaceId) {
  return harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspace}/source/sync`,
    cookies,
  })
}

async function documents(): Promise<{ id: string; title: string }[]> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: viewer,
  })
  expect(response.statusCode).toBe(200)
  return response.json<{ id: string; title: string }[]>()
}

async function documentTitled(title: string): Promise<string> {
  const found = (await documents()).find((document) => document.title === title)
  if (found === undefined) throw new Error(`no document titled ${title}`)
  return found.id
}

describe('a workspace read from a repository', () => {
  let first: string
  let second: string

  it('refuses to configure a source for anybody but an instance administrator', async () => {
    expect((await configure(editor)).statusCode).toBe(403)
    expect((await source()).json()).toMatchObject({ error: { code: 'workspace_not_sourced' } })
  })

  it('refuses settings ADR-061 does not allow, naming the setting', async () => {
    const http = await configure(admin, { remote: 'http://github.com/acme/handbook.git' })
    expect(http.statusCode).toBe(422)
    expect(http.json()).toMatchObject({
      error: { code: 'invalid_source', details: { field: 'remote' } },
    })
    const glob = await configure(admin, {
      collections: [{ slug: 'guides', name: 'Guides', path: 'docs/**' }],
    })
    expect(glob.json()).toMatchObject({ error: { details: { field: 'collections' } } })
  })

  it('configures the source, and the sync it asks for replays the repository', async () => {
    first = await commit('Add the setup guide', {
      'docs/guides/setup.md': '# Setup\n\nInstall the tools.\n',
      'internal/salaries.md': '# Never fetched\n',
    })
    second = await commit(
      'Add the deploy guide',
      { 'docs/guides/deploy.md': '---\ntitle: Deploying\n---\n\nShip it.\n' },
      '2025-12-31T00:00:00Z',
    )

    const configured = await configure(admin)
    expect(configured.statusCode).toBe(200)
    expect(configured.json()).toMatchObject({
      remote: pathToFileURL(bare).href,
      branch: 'main',
      collections: [{ slug: 'guides', name: 'Guides', path: 'docs/guides' }],
      credential: null,
      sync: null,
    })

    await harness.drainOutbox()

    const synced = await source()
    expect(synced.json()).toMatchObject({
      sync: { lastSyncedRevision: second, failure: null, refused: [] },
    })
    expect((await documents()).map(({ title }) => title).toSorted()).toEqual(['Deploying', 'Setup'])

    const setup = await documentTitled('Setup')
    const history = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${setup}/history`,
      cookies: viewer,
    })
    expect(history.json()).toMatchObject({
      revisions: [
        {
          author: { name: 'Ada Author', email: 'ada@example.com' },
          timestamp: '2025-12-30T00:00:00.000Z',
          changeNote: 'Add the setup guide',
        },
      ],
    })
    expect(first).not.toBe(second)
  })

  it('lets only someone who manages the workspace read the source', async () => {
    expect((await source(editor)).statusCode).toBe(403)
    expect((await source(viewer)).statusCode).toBe(403)
  })

  it('refuses every write a person asks for, with its own code', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: admin,
      payload: { collectionId: tenancy.collectionId, title: 'Written in Quill' },
    })
    expect(created.statusCode).toBe(403)
    expect(created.json()).toMatchObject({ error: { code: 'workspace_read_only' } })
  })

  it('brings a later push in when an administrator asks for a sync', async () => {
    const third = await commit(
      'Explain the tools',
      { 'docs/guides/setup.md': '# Setup\n\nInstall the tools, then sign in.\n' },
      '2025-12-31T12:00:00Z',
    )
    expect((await syncNow(editor)).statusCode).toBe(403)
    const requested = await syncNow(admin)
    expect(requested.statusCode).toBe(202)
    expect(requested.json()).toEqual({ requested: true })

    await harness.drainOutbox()

    expect((await source()).json()).toMatchObject({ sync: { lastSyncedRevision: third } })
    const content = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${await documentTitled('Setup')}/content`,
      cookies: viewer,
    })
    expect(content.json<{ markdown: string }>().markdown).toContain('then sign in')
  })

  it('does nothing more when the source has not moved', async () => {
    expect((await syncNow(admin)).statusCode).toBe(202)
    await harness.drainOutbox()
    expect(await documents()).toHaveLength(2)
  })

  it('changes the settings of a workspace it already reads', async () => {
    const changed = await configure(admin, { commitMessages: 'none' })
    expect(changed.statusCode).toBe(200)
    expect(changed.json()).toMatchObject({
      commitMessages: 'none',
      sync: { failure: null },
    })
    await harness.drainOutbox()
  })

  it('answers that a native workspace reads from no source', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: admin,
      payload: { unitId: tenancy.unitId, name: 'Native', slug: 'native' },
    })
    const native = created.json<{ id: string }>().id
    const response = await syncNow(admin, native)
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: 'workspace_not_sourced' } })
  })

  it('records a sync that failed on the source, for an administrator to read', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: admin,
      payload: { unitId: tenancy.unitId, name: 'Wrong branch', slug: 'wrong-branch' },
    })
    const workspace = created.json<{ id: string }>().id
    const configured = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
      payload: {
        remote: pathToFileURL(bare).href,
        branch: 'no-such-branch',
        collections: [{ slug: 'guides', name: 'Guides', path: 'docs/guides' }],
        history: 'full',
        commitMessages: 'subject',
        credential: null,
      },
    })
    expect(configured.statusCode).toBe(200)

    await harness.drainOutbox()

    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
    })
    expect(read.json()).toMatchObject({
      sync: {
        lastSyncedRevision: null,
        lastSyncedAt: null,
        failure: { reason: 'branch-not-found', revision: null },
      },
    })
  })

  it('refuses to make a workspace that already holds documents sourced', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: admin,
      payload: { unitId: tenancy.unitId, name: 'Written here', slug: 'written-here' },
    })
    const workspace = created.json<{ id: string }>().id
    const collection = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace}/collections`,
      cookies: admin,
      payload: { name: 'Notes' },
    })
    const document = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace}/documents`,
      cookies: admin,
      payload: { collectionId: collection.json<{ id: string }>().id, title: 'A note' },
    })
    expect(document.statusCode).toBe(201)

    const response = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
      payload: {
        remote: pathToFileURL(bare).href,
        branch: 'main',
        collections: [{ slug: 'guides', name: 'Guides', path: 'docs/guides' }],
        history: 'head',
        commitMessages: 'subject',
        credential: null,
      },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: 'workspace_not_empty' } })
  })
})

/** A second repository, whose manifest decides the workspace's structure. */
interface Repository {
  readonly work: string
  readonly bare: string
}

async function createRepository(name: string): Promise<Repository> {
  const repository = { work: join(root, `${name}-work`), bare: join(root, `${name}.git`) }
  await mkdir(repository.work)
  git(repository.work, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', repository.bare])
  git(repository.bare, ['config', 'uploadpack.allowFilter', 'true'])
  return repository
}

/** Writes and removes files, commits, and pushes; answers the commit. */
async function commitTo(
  repository: Repository,
  message: string,
  files: Readonly<Record<string, string | null>>,
  committedAt: string,
): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      git(repository.work, ['rm', '--quiet', path])
      continue
    }
    await mkdir(dirname(join(repository.work, path)), { recursive: true })
    await writeFile(join(repository.work, path), content)
  }
  git(repository.work, ['add', '--all'])
  git(repository.work, ['commit', '--quiet', '--no-verify', '-m', message], committedAt)
  git(repository.work, ['push', '--quiet', repository.bare, 'HEAD:refs/heads/main'])
  return git(repository.work, ['rev-parse', 'HEAD'])
}

interface TreeDocument {
  readonly id: string
  readonly title: string
  readonly children: readonly TreeDocument[]
}

interface TreeCollection {
  readonly slug: string
  readonly name: string
  readonly documents: readonly TreeDocument[]
}

const manifest = (lines: readonly string[]) => `${['version: 1', ...lines].join('\n')}\n`

const titlesIn = (collections: readonly TreeCollection[], slug: string) =>
  collections.find((collection) => collection.slug === slug)?.documents.map(({ title }) => title)

describe('a workspace whose repository has a manifest', () => {
  const manifestPath = '.quill/workspace.yaml'
  let repository: Repository
  let workspace: string
  let setupId: string

  const firstManifest = manifest([
    'collections:',
    '  - { slug: guides, title: Guides, path: docs/guides }',
    '  - { slug: decisions, title: Decisions, path: docs/adr, order: filename }',
    'exclude: [docs/guides/drafts]',
    'owner: docs-team',
  ])

  async function tree(): Promise<readonly TreeCollection[]> {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace}/tree`,
      cookies: admin,
    })
    expect(response.statusCode).toBe(200)
    return response.json<{ collections: readonly TreeCollection[] }>().collections
  }

  async function sourceOf(): Promise<{ sync: Record<string, unknown> }> {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
    })
    return response.json<{ sync: Record<string, unknown> }>()
  }

  async function syncWorkspace(): Promise<void> {
    expect((await syncNow(admin, workspace)).statusCode).toBe(202)
    await harness.drainOutbox()
  }

  beforeAll(async () => {
    repository = await createRepository('manifest')
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: admin,
      payload: { unitId: tenancy.unitId, name: 'Manifest handbook', slug: 'manifest-handbook' },
    })
    workspace = created.json<{ id: string }>().id
  })

  it('places the files by the manifest: its collections, nested folders, an index, an order', async () => {
    const head = await commitTo(
      repository,
      'Write the handbook',
      {
        [manifestPath]: firstManifest,
        'docs/guides/intro.md': '---\norder: 1\n---\n\n# Introduction\n',
        'docs/guides/setup.md': '# Setup\n\nInstall the tools.\n',
        'docs/guides/advanced/index.md': 'All about the advanced topics.\n',
        'docs/guides/advanced/tuning.md': '# Tuning\n',
        'docs/guides/drafts/wip.md': '# Not ready\n',
        'docs/adr/0001-first.md': '# Zeta decision\n',
        'docs/adr/0002-second.md': '# Alpha decision\n',
        'src/app.ts': 'export {}\n',
      },
      '2025-12-30T00:00:00Z',
    )
    const configured = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
      payload: {
        remote: pathToFileURL(repository.bare).href,
        branch: 'main',
        // Where the source has a manifest, the manifest decides; this collection is adopted by slug.
        collections: [{ slug: 'guides', name: 'Guides from the settings', path: 'docs' }],
        history: 'full',
        commitMessages: 'subject',
        credential: null,
      },
    })
    expect(configured.statusCode).toBe(200)
    await harness.drainOutbox()

    expect((await sourceOf()).sync).toMatchObject({ lastSyncedRevision: head, failure: null })
    const collections = await tree()
    expect(collections.map(({ slug, name }) => [slug, name]).toSorted()).toEqual([
      ['decisions', 'Decisions'],
      ['guides', 'Guides'],
    ])
    // Front matter order first, then by title; the excluded draft is not read; an index is named by its folder.
    expect(titlesIn(collections, 'guides')).toEqual(['Introduction', 'Advanced', 'Setup', 'Tuning'])
    // By file name, whatever the titles say.
    expect(titlesIn(collections, 'decisions')).toEqual(['Zeta decision', 'Alpha decision'])
    setupId = await documentIn(workspace, 'Setup')
  })

  it('keeps the id of a file the manifest redirects to its rewritten replacement', async () => {
    await commitTo(
      repository,
      'Rewrite the setup guide as getting started',
      {
        [manifestPath]: `${firstManifest}redirects: { docs/guides/setup.md: docs/guides/getting-started.md }\n`,
        'docs/guides/setup.md': null,
        'docs/guides/getting-started.md':
          '# Getting started\n\nNothing like the old guide at all.\n',
      },
      '2025-12-31T00:00:00Z',
    )
    await syncWorkspace()
    expect(await documentIn(workspace, 'Getting started')).toBe(setupId)
  })

  it('re-plans the tree when only the manifest changes', async () => {
    const decisions = await documentIn(workspace, 'Zeta decision')
    const head = await commitTo(
      repository,
      'Fold the decisions into the guides',
      {
        [manifestPath]: manifest([
          'collections:',
          '  - { slug: guides, title: The guides, path: docs, order: filename }',
          'exclude: [docs/guides/drafts]',
        ]),
      },
      '2025-12-31T06:00:00Z',
    )
    await syncWorkspace()

    expect((await sourceOf()).sync).toMatchObject({ lastSyncedRevision: head, failure: null })
    const collections = await tree()
    expect(collections.map(({ slug, name }) => [slug, name])).toEqual([['guides', 'The guides']])
    // The introduction still says it goes first; the rest by file name now.
    expect(titlesIn(collections, 'guides')).toEqual([
      'Introduction',
      'Zeta decision',
      'Alpha decision',
      'Getting started',
      'Advanced',
      'Tuning',
    ])
    // The same document, moved: its file did not change.
    expect(await documentIn(workspace, 'Zeta decision')).toBe(decisions)
  })

  it('records a manifest that does not read, with its line, and keeps what was synced', async () => {
    await commitTo(
      repository,
      'Break the manifest',
      {
        [manifestPath]: manifest([
          'collections:',
          '  - { slug: guides, title: The guides, path: "**/*.md" }',
        ]),
      },
      '2025-12-31T09:00:00Z',
    )
    await syncWorkspace()
    expect((await sourceOf()).sync).toMatchObject({
      failure: {
        reason: 'invalid-manifest',
        message: expect.stringContaining('.quill/workspace.yaml, line 3'),
      },
    })
    expect(titlesIn(await tree(), 'guides')).toHaveLength(6)
  })
})

async function documentIn(workspace: string, title: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${workspace}/documents`,
    cookies: admin,
  })
  const found = response
    .json<{ id: string; title: string }[]>()
    .find((document) => document.title === title)
  if (found === undefined) throw new Error(`no document titled ${title}`)
  return found.id
}

/** A one-pixel PNG, as a repository's diagram might be. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('a workspace whose repository links its files to each other', () => {
  const forge = 'https://git.example.com/acme/handbook/blob'
  let repository: Repository
  let workspace: string
  let first: string
  let setupId: string
  let authId: string

  const SETUP = [
    '# Setup',
    '',
    'Read [token rotation](../adr/0012-auth.md#token-rotation) first, then',
    'the [draft](drafts/wip.md), the [code](../../src/app.ts) and the [missing page](./missing.md).',
    '',
    '```md',
    '[not a link](./in-code.md)',
    '```',
    '',
    '![The flow](../diagrams/flow.png)',
    '',
  ].join('\n')

  async function rendered(id: string, cookies: Record<string, string>): Promise<string> {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${id}/rendered`,
      cookies,
    })
    expect(response.statusCode).toBe(200)
    return response.json<{ html: string }>().html
  }

  async function brokenLinks(): Promise<unknown> {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
    })
    return response.json<{ sync: { brokenLinks: unknown } }>().sync.brokenLinks
  }

  beforeAll(async () => {
    repository = await createRepository('links')
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: admin,
      payload: { unitId: tenancy.unitId, name: 'Linked handbook', slug: 'linked-handbook' },
    })
    workspace = created.json<{ id: string }>().id
    const granted = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.viewer,
      scopeKind: 'workspace',
      scopeId: workspace,
      role: 'viewer',
      effect: 'allow',
      createdBy: tenancy.admin,
    })
    if (granted.kind !== 'created') throw new Error(`the viewer was not granted: ${granted.kind}`)
  })

  it('syncs a repository whose files link to each other, with a forge address to link outside it', async () => {
    first = await commitTo(
      repository,
      'Write the linked handbook',
      {
        '.quill/workspace.yaml': manifest([
          'collections:',
          '  - { slug: guides, title: Guides, path: docs/guides }',
          '  - { slug: decisions, title: Decisions, path: docs/adr }',
          'exclude: [docs/guides/drafts]',
          'assets: [docs/diagrams]',
        ]),
        'docs/guides/setup.md': SETUP,
        'docs/guides/drafts/wip.md': '# Not ready\n',
        'docs/adr/0012-auth.md': '# Authentication\n\n## Token rotation\n\nRotate them.\n',
        'src/app.ts': 'export {}\n',
      },
      '2025-12-30T00:00:00Z',
    )
    await mkdir(join(repository.work, 'docs/diagrams'), { recursive: true })
    await writeFile(join(repository.work, 'docs/diagrams/flow.png'), PIXEL_PNG)
    first = await commitTo(repository, 'Draw the flow', {}, '2025-12-30T01:00:00Z')

    const configured = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
      payload: {
        remote: pathToFileURL(repository.bare).href,
        branch: 'main',
        collections: [{ slug: 'guides', name: 'Guides', path: 'docs/guides' }],
        history: 'full',
        commitMessages: 'subject',
        credential: null,
        viewTemplate: 'https://git.example.com/acme/handbook/blob/{commit}/{path}',
      },
    })
    expect(configured.statusCode).toBe(200)
    expect(configured.json()).toMatchObject({
      outsideLinks: 'forge',
      viewTemplate: 'https://git.example.com/acme/handbook/blob/{commit}/{path}',
    })
    await harness.drainOutbox()
    setupId = await documentIn(workspace, 'Setup')
    authId = await documentIn(workspace, 'Authentication')
  })

  it('resolves each relative link at render: across collections to a heading, else to the forge at the synced commit', async () => {
    const html = await rendered(setupId, admin)

    expect(html).toContain(`<a href="/d/${authId}#user-content-token-rotation">token rotation</a>`)
    // Excluded, outside the source, and not in the repository: each to the file at the synced commit.
    expect(html).toContain(`<a href="${forge}/${first}/docs/guides/drafts/wip.md"`)
    expect(html).toContain(`<a href="${forge}/${first}/src/app.ts"`)
    expect(html).toContain(`<a href="${forge}/${first}/docs/guides/missing.md"`)
    // The heading the link names is there to land on.
    expect(await rendered(authId, admin)).toContain('id="user-content-token-rotation"')

    // The stored copy is the repository's text: nothing was rewritten at sync.
    const content = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${setupId}/content`,
      cookies: admin,
    })
    expect(content.json<{ markdown: string }>().markdown).toContain(
      '(../adr/0012-auth.md#token-rotation)',
    )
  })

  it('records the resolved links, so the decision knows the guide links to it', async () => {
    const backlinks = await harness.deps.uow.repos.documentLinks.listSourcesTargeting(
      authId as DocumentId,
    )
    expect(backlinks).toEqual([setupId])
  })

  it('shows a reader who may not see the decision the link’s words, with no address', async () => {
    const denied = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.viewer,
      scopeKind: 'document',
      scopeId: authId,
      role: 'viewer',
      effect: 'deny',
      createdBy: tenancy.admin,
    })
    expect(denied.kind).toBe('created')

    const html = await rendered(setupId, viewer)
    expect(html).toContain('Read token rotation first')
    expect(html).not.toContain(`/d/${authId}`)
    // What the reader may follow is left as it was.
    expect(html).toContain(`<a href="${forge}/${first}/src/app.ts"`)
    expect(await rendered(setupId, admin)).toContain(`/d/${authId}#user-content-token-rotation`)
  })

  it('lists the link to a file that is not in the repository at the synced commit as broken', async () => {
    expect(await brokenLinks()).toEqual([
      { path: 'docs/guides/setup.md', url: './missing.md', revision: first },
    ])
  })

  it('resolves against the newest revision once the missing file arrives, and lists nothing broken', async () => {
    const head = await commitTo(
      repository,
      'Write the missing page',
      { 'docs/guides/missing.md': '# Missing no more\n' },
      '2025-12-31T00:00:00Z',
    )
    expect((await syncNow(admin, workspace)).statusCode).toBe(202)
    await harness.drainOutbox()

    const missing = await documentIn(workspace, 'Missing no more')
    const html = await rendered(setupId, admin)
    expect(html).toContain(`<a href="/d/${missing}">missing page</a>`)
    expect(html).toContain(`<a href="${forge}/${head}/src/app.ts"`)
    expect(await brokenLinks()).toEqual([])
  })
})
