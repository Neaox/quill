import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'

/**
 * Folders as documents, end to end (ADR-061, "Tree, titles and order"): a
 * repository laid out as lockstay's docs are, a folder with a `README.md`
 * for each page and links between them, read through the real `git` adapter,
 * lock, outbox lane and Postgres. A workspace synced before folders were
 * documents is placed again on its next sync, keeping every id.
 */

let harness: ServerHarness
/** This file's own workspace: the sync lock is held across the whole database. */
let workspaceId: string
let admin: Record<string, string>
let root: string
let work: string
let bare: string

function git(cwd: string, args: readonly string[]): string {
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
      GIT_AUTHOR_DATE: '2025-12-30T00:00:00Z',
      GIT_COMMITTER_DATE: '2025-12-30T00:00:00Z',
    },
  }).trim()
}

/** Writes and removes files, commits, and pushes; answers the commit. */
async function commit(
  message: string,
  files: Readonly<Record<string, string>>,
  removed: readonly string[] = [],
): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(work, path)), { recursive: true })
    await writeFile(join(work, path), content)
  }
  if (removed.length > 0) git(work, ['rm', '--quiet', '--', ...removed])
  git(work, ['add', '--all'])
  git(work, ['commit', '--quiet', '--no-verify', '-m', message])
  git(work, ['push', '--quiet', bare, 'HEAD:refs/heads/main'])
  return git(work, ['rev-parse', 'HEAD'])
}

async function syncNow(): Promise<void> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspaceId}/source/sync`,
    cookies: admin,
  })
  expect(response.statusCode).toBe(202)
  await harness.drainOutbox()
}

interface Listed {
  readonly id: string
  readonly parentId: string | null
  readonly path: string
  readonly title: string
  readonly status: string
}

async function documents(): Promise<readonly Listed[]> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${workspaceId}/documents`,
    cookies: admin,
  })
  expect(response.statusCode).toBe(200)
  return response.json<Listed[]>().filter(({ status }) => status !== 'archived')
}

/** The live documents as a tree of titles, each under the title of the one it nests under. */
async function tree(): Promise<Record<string, string | null>> {
  const live = await documents()
  const titles = new Map(live.map(({ id, title }) => [id, title]))
  return Object.fromEntries(
    live.map(({ title, parentId }) => [
      title,
      parentId === null ? null : (titles.get(parentId) ?? '?'),
    ]),
  )
}

async function idOf(title: string): Promise<string> {
  const found = (await documents()).find((document) => document.title === title)
  if (found === undefined) throw new Error(`no document titled ${title}`)
  return found.id
}

async function rendered(id: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/documents/${id}/rendered`,
    cookies: admin,
  })
  expect(response.statusCode).toBe(200)
  return response.json<{ html: string }>().html
}

async function syncState() {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${workspaceId}/source`,
    cookies: admin,
  })
  return response.json<{
    sync: {
      lastSyncedRevision: string
      failure: unknown
      brokenLinks: { path: string; url: string }[] | null
    }
  }>().sync
}

const GUIDE = [
  '# Guide',
  'Start with [tenancy](./concepts/tenancy/README.md), then [requests](./concepts/requests/).',
  'Every idea is under [the concepts](concepts).',
  'This one is [nowhere](./concepts/nowhere/).',
].join('\n\n')

beforeAll(async () => {
  harness = await createServerHarness()
  const tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/workspaces',
    cookies: admin,
    payload: { unitId: tenancy.unitId, name: 'Lockstay docs', slug: 'lockstay-docs' },
  })
  workspaceId = created.json<{ id: string }>().id

  root = await mkdtemp(join(tmpdir(), 'quill-source-folders-'))
  work = join(root, 'work')
  bare = join(root, 'docs.git')
  await mkdir(work)
  git(work, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  git(bare, ['config', 'uploadpack.allowFilter', 'true'])
}, 60_000)

afterAll(async () => {
  await harness.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

describe('a repository of folders, each with a README', () => {
  it('reads every folder as a document, its files and folders nested under it', async () => {
    await commit('Write the guide', {
      'docs/guide/README.md': GUIDE,
      'docs/guide/concepts/README.md': '# Concepts\n\nThe ideas.\n',
      'docs/guide/concepts/tenancy/README.md': '# Tenancy\n\nSee [isolation](isolation.md).\n',
      'docs/guide/concepts/tenancy/isolation.md': '# Isolation\n',
      'docs/guide/concepts/requests/README.md': '# Requests\n\nBack to [the guide](../../).\n',
      'docs/changelog.md': '# Changelog\n',
    })
    const configured = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${workspaceId}/source`,
      cookies: admin,
      payload: {
        remote: pathToFileURL(bare).href,
        branch: 'main',
        collections: [{ slug: 'docs', name: 'Docs', path: 'docs' }],
        history: 'full',
        commitMessages: 'subject',
        credential: null,
      },
    })
    expect(configured.statusCode).toBe(200)
    await harness.drainOutbox()

    expect(await tree()).toEqual({
      Changelog: null,
      Guide: null,
      Concepts: 'Guide',
      Tenancy: 'Concepts',
      Isolation: 'Tenancy',
      Requests: 'Concepts',
    })
  })

  it("sends a link to a folder, to it with a slash, or to its README, to the folder's document", async () => {
    const html = await rendered(await idOf('Guide'))
    expect(html).toContain(`href="/d/${await idOf('Tenancy')}"`)
    expect(html).toContain(`href="/d/${await idOf('Requests')}"`)
    expect(html).toContain(`href="/d/${await idOf('Concepts')}"`)
    expect(await rendered(await idOf('Requests'))).toContain(`href="/d/${await idOf('Guide')}"`)
    // The one folder the repository does not have is the one broken link.
    expect((await syncState()).brokenLinks).toEqual([
      expect.objectContaining({ path: 'docs/guide/README.md', url: './concepts/nowhere/' }),
    ])
  })

  it('places a workspace synced before folders were documents again, with the same ids', async () => {
    const before = await documents()
    // As the release before this one left it: every document at the top, and
    // a layout recorded with no tree.
    await harness.database.pool.query(
      'UPDATE documents SET parent_id = NULL, sort_key = NULL WHERE workspace_id = $1',
      [workspaceId],
    )
    await harness.database.pool.query(
      `UPDATE source_sync_state
          SET layout = jsonb_set(layout, '{fingerprint}', to_jsonb(replace(layout->>'fingerprint', ',"tree":"folders"', '')))
        WHERE workspace_id = $1`,
      [workspaceId],
    )
    expect(Object.values(await tree()).every((parent) => parent === null)).toBe(true)

    await syncNow()

    const after = await documents()
    expect(after.map(({ id }) => id).toSorted()).toEqual(before.map(({ id }) => id).toSorted())
    expect(after.map(({ parentId }) => parentId).toSorted()).toEqual(
      before.map(({ parentId }) => parentId).toSorted(),
    )
    expect((await syncState()).failure).toBeNull()
  })
})

describe('a later push that changes the folders', () => {
  it('keeps a folder whose README goes as the same page, and writes one for a new folder', async () => {
    const concepts = await idOf('Concepts')
    const tenancy = await idOf('Tenancy')
    const head = await commit(
      'Move the concepts overview into the guide, add how-to guides',
      { 'docs/guide/how-to/deploy.md': '# Deploy\n' },
      ['docs/guide/concepts/README.md'],
    )
    await syncNow()

    expect((await syncState()).lastSyncedRevision).toBe(head)
    expect(await idOf('Concepts')).toBe(concepts)
    expect(await tree()).toMatchObject({
      Concepts: 'Guide',
      Tenancy: 'Concepts',
      'How to': 'Guide',
      Deploy: 'How to',
    })
    expect((await documents()).find(({ id }) => id === tenancy)?.parentId).toBe(concepts)
    // No folder, file or page twice.
    const paths = (await documents()).map(({ path }) => path)
    expect(new Set(paths).size).toBe(paths.length)

    // The page lists the folder's pages.
    const children = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${concepts}/children`,
      cookies: admin,
    })
    expect(children.json<{ html: string }>().html).toContain('Tenancy')
    expect(await rendered(await idOf('Guide'))).toContain(`href="/d/${concepts}"`)
  })

  it('gives a new README the page its folder already had', async () => {
    const howTo = await idOf('How to')
    await commit('Introduce the how-to guides', {
      'docs/guide/how-to/README.md': '# How-to guides\n',
    })
    await syncNow()
    expect(await idOf('How-to guides')).toBe(howTo)
    expect(await tree()).toMatchObject({ 'How-to guides': 'Guide', Deploy: 'How-to guides' })
  })
})
