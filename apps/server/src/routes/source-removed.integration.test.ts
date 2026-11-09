import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createGrant, defaultOrganisationSettings, publicDocumentPaths } from '@quill/application'
import type { OrganisationSettings } from '@quill/application'
import { collectionId as toCollectionId, documentId, workspaceId } from '@quill/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Removed and renamed files of a sourced workspace, end to end with real
 * `git` (ADR-061, ADR-046): a removed file's page answers 410 to its readers
 * and on the public site; a path the manifest redirects leads to its
 * replacement, in the app, on the public site, and from other pages' links;
 * a rename Git pairs keeps the page and its address; and nobody the page was
 * hidden from learns anything.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>
let root: string
let work: string
let bare: string
let workspace: string
let collectionId: string
const SITE = 'removed-handbook'

let clock = Date.parse('2025-12-01T00:00:00Z')

function git(cwd: string, args: readonly string[]): string {
  clock += 60_000
  const at = new Date(clock).toISOString()
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
      GIT_COMMITTER_NAME: 'Ada Author',
      GIT_COMMITTER_EMAIL: 'ada@example.com',
      GIT_AUTHOR_DATE: at,
      GIT_COMMITTER_DATE: at,
    },
  }).trim()
}

/** Writes and removes files (`null`), moves (`[from, to]`), commits, pushes; answers the commit. */
async function commit(
  message: string,
  files: Readonly<Record<string, string | null>>,
  moves: readonly (readonly [string, string])[] = [],
): Promise<string> {
  for (const [from, to] of moves) git(work, ['mv', from, to])
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      git(work, ['rm', '--quiet', path])
      continue
    }
    await mkdir(dirname(join(work, path)), { recursive: true })
    await writeFile(join(work, path), content)
  }
  git(work, ['add', '--all'])
  git(work, ['commit', '--quiet', '--no-verify', '-m', message])
  git(work, ['push', '--quiet', bare, 'HEAD:refs/heads/main'])
  return git(work, ['rev-parse', 'HEAD'])
}

async function sync(): Promise<void> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspace}/source/sync`,
    cookies: admin,
  })
  expect(response.statusCode).toBe(202)
  await harness.drainOutbox()
}

/** The document a path holds now, by the path map. */
async function idAt(path: string): Promise<string> {
  const rows = await harness.deps.uow.repos.sourcePaths.listByWorkspace(workspaceId(workspace))
  const row = rows.find((candidate) => candidate.path === path)
  if (row === undefined) throw new Error(`no path map entry for ${path}`)
  return row.documentId
}

function read(id: string, cookies: Record<string, string> = viewer) {
  return harness.app.inject({ method: 'GET', url: `/api/documents/${id}`, cookies })
}

async function publicPathOf(id: string): Promise<string> {
  const collection = await harness.deps.uow.repos.collections.findById(toCollectionId(collectionId))
  if (collection === null) throw new Error('no collection')
  const documents = await harness.deps.uow.repos.documents.listByCollection(collection.id)
  const path = publicDocumentPaths(collection, documents).get(documentId(id))
  if (path === undefined) throw new Error(`no public path for ${id}`)
  return path
}

const manifest = (redirects: string) =>
  [
    'version: 1',
    'collections:',
    '  - { slug: handbook, title: Handbook, path: docs }',
    redirects,
    '',
  ].join('\n')

let removedAt: string
let oldId: string
let goneId: string

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)
  root = await mkdtemp(join(tmpdir(), 'quill-source-removed-'))
  work = join(root, 'work')
  bare = join(root, 'handbook.git')
  await mkdir(work)
  git(work, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  git(bare, ['config', 'uploadpack.allowFilter', 'true'])

  await commit('Write the handbook', {
    '.quill/workspace.yaml': manifest(''),
    'docs/index.md': '# Start\n\nSee [the gone page](gone.md) and [the old setup](old-setup.md).\n',
    'docs/gone.md': '# Gone page\n',
    'docs/old-setup.md': '# Old setup\n',
    'docs/rename-me.md': '# Renamed page\n\nSome words that stay the same.\n',
  })

  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/workspaces',
    cookies: admin,
    payload: { unitId: tenancy.unitId, name: 'Removed handbook', slug: 'removed-handbook' },
  })
  workspace = created.json<{ id: string }>().id
  const configured = await harness.app.inject({
    method: 'PUT',
    url: `/api/workspaces/${workspace}/source`,
    cookies: admin,
    payload: {
      remote: pathToFileURL(bare).href,
      branch: 'main',
      collections: [],
      history: 'full',
      commitMessages: 'subject',
      credential: null,
    },
  })
  if (configured.statusCode !== 200) throw new Error(`not configured: ${configured.body}`)
  await harness.drainOutbox()
  goneId = await idAt('docs/gone.md')
  oldId = await idAt('docs/old-setup.md')
  // The outsider may not read the page that will be removed.
  const denied = await createGrant(harness.deps, {
    principalKind: 'user',
    principalId: tenancy.outsider,
    scopeKind: 'document',
    scopeId: goneId,
    role: 'viewer',
    effect: 'deny',
    createdBy: tenancy.admin,
  })
  if (denied.kind !== 'created') throw new Error(`the outsider was not denied: ${denied.kind}`)
  const collections = await harness.deps.uow.repos.collections.listByWorkspace(
    workspaceId(workspace),
  )
  collectionId = collections[0]?.id ?? ''

  // Public, so the site's answers can be read too.
  const current = await harness.app.inject({
    method: 'GET',
    url: '/api/settings/organisation',
    cookies: admin,
  })
  const body = current.json<{ settings: OrganisationSettings; revision: string | null }>()
  await harness.app.inject({
    method: 'PUT',
    url: '/api/settings/organisation',
    cookies: admin,
    payload: {
      settings: {
        ...body.settings,
        policies: { ...defaultOrganisationSettings().policies, publicPublishingAllowed: true },
      },
      expectedRevision: body.revision,
    },
  })
  const published = await harness.app.inject({
    method: 'POST',
    url: `/api/collections/${collectionId}/public`,
    cookies: admin,
    payload: { siteSlug: SITE },
  })
  if (published.statusCode !== 200) throw new Error(`not published: ${published.body}`)

  // The gone page and the old setup are removed; the setup's replacement
  // arrives a commit later, with the manifest's redirect to it.
  removedAt = await commit('Remove two pages', { 'docs/gone.md': null, 'docs/old-setup.md': null })
  await commit(
    'Add the new setup, and redirect the old one',
    {
      '.quill/workspace.yaml': manifest('redirects: { docs/old-setup.md: docs/new-setup.md }'),
      'docs/new-setup.md': '# New setup\n',
    },
    [['docs/rename-me.md', 'docs/renamed.md']],
  )
  await sync()
  harness.deps.publicSiteCache.invalidate()
}, 120_000)

afterAll(async () => {
  await harness.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

describe('a page whose file left its repository', () => {
  it('answers 410 to its readers, with its title and the commit that removed it', async () => {
    const response = await read(goneId)
    expect(response.statusCode).toBe(410)
    expect(response.json()).toMatchObject({
      error: {
        code: 'document_removed',
        details: { title: 'Gone page', revision: removedAt, replacement: null },
      },
    })
  })

  it('answers somebody it was hidden from exactly as before', async () => {
    const response = await read(goneId, outsider)
    expect(response.statusCode).not.toBe(410)
    expect(JSON.stringify(response.json())).not.toContain('Gone page')
  })

  it('names the page the manifest redirects its old path to', async () => {
    const response = await read(oldId)
    expect(response.statusCode).toBe(410)
    const newId = await idAt('docs/new-setup.md')
    expect(response.json()).toMatchObject({
      error: { details: { title: 'Old setup', replacement: { id: newId, title: 'New setup' } } },
    })
  })

  it('keeps a renamed file’s page, and every address it had', async () => {
    const id = await idAt('docs/renamed.md')
    const response = await read(id)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ title: 'Renamed page', path: 'docs/renamed.md' })
    // The id it was first given is the one it still has.
    const rows = await harness.deps.uow.repos.sourcePaths.listByWorkspace(workspaceId(workspace))
    expect(rows.some((row) => row.path === 'docs/rename-me.md')).toBe(false)
  })
})

describe('the workspace', () => {
  it('no longer lists a removed page in its tree', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace}/tree`,
      cookies: admin,
    })
    expect(response.statusCode).toBe(200)
    const titles = [...response.body.matchAll(/"title":"([^"]+)"/gu)].map(([, title]) => title)
    expect(titles.toSorted()).toEqual(['New setup', 'Renamed page', 'Start'])
  })
})

describe('links to a removed or redirected path', () => {
  it('lead to the removed page, which says so, and to the redirect’s page', async () => {
    const start = await idAt('docs/index.md')
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${start}/rendered`,
      cookies: viewer,
    })
    expect(response.statusCode).toBe(200)
    const { html } = response.json<{ html: string }>()
    expect(html).toContain(`href="/d/${goneId}"`)
    expect(html).toContain(`href="/d/${await idAt('docs/new-setup.md')}"`)
  })

  it('reports the removed path as broken, and not the one a redirect leads on from', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace}/source`,
      cookies: admin,
    })
    const links = response.json<{ sync: { brokenLinks: { url: string }[] } }>().sync.brokenLinks
    expect(links.map(({ url }) => url)).toEqual(['gone.md'])
  })
})

describe('the public site', () => {
  it('answers 410 for a removed page that was public', async () => {
    const path = await publicPathOf(goneId)
    const response = await harness.app.inject({ method: 'GET', url: `/s/${SITE}/${path}` })
    expect(response.statusCode).toBe(410)
    expect(response.body).toContain('This page was removed')
    expect(response.body).toContain('Gone page')
  })

  it('sends a redirected page’s old address to its replacement', async () => {
    const from = await publicPathOf(oldId)
    const to = await publicPathOf(await idAt('docs/new-setup.md'))
    const response = await harness.app.inject({ method: 'GET', url: `/s/${SITE}/${from}` })
    expect(response.statusCode).toBe(301)
    expect(response.headers.location).toBe(`/s/${SITE}/${to}`)
  })

  it('no longer lists a removed page', async () => {
    const response = await harness.app.inject({ method: 'GET', url: `/s/${SITE}` })
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('Gone page')
    expect(response.body).toContain('New setup')
  })
})
