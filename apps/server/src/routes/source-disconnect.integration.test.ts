import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createGrant, setSecret, SOURCE_DISCONNECTED } from '@quill/application'
import { workspaceId as toWorkspaceId } from '@quill/domain'
import { parseDocument } from '@quill/markdown'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Disconnecting a source, end to end (ADR-061, amendment of 11 November
 * 2026): a workspace read from a real repository becomes native and keeps
 * everything — its pages edit and publish as any other, the relative links in
 * the text it was synced with still lead where they did, a page whose file
 * had left the repository still answers 410, and the repository is never
 * read from again.
 */

const WEBHOOK_SECRET_NAME = 'sources/manual-webhook'
const WEBHOOK_SECRET = 'a-shared-webhook-secret'

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>
let workspace: string
let root: string
let work: string
let bare: string
let startId: string
let guideId: string
let goneId: string

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
    },
  }).trim()
}

async function commit(message: string, files: Readonly<Record<string, string | null>>) {
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
}

async function idAt(path: string): Promise<string> {
  const rows = await harness.deps.uow.repos.sourcePaths.listByWorkspace(toWorkspaceId(workspace))
  const row = rows.find((candidate) => candidate.path === path)
  if (row === undefined) throw new Error(`no path map entry for ${path}`)
  return row.documentId
}

function inject(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  cookies = admin,
  payload?: object,
) {
  return harness.app.inject({ method, url, cookies, ...(payload === undefined ? {} : { payload }) })
}

const SETTINGS = () => ({
  remote: pathToFileURL(bare).href,
  branch: 'main',
  collections: [{ slug: 'manual', name: 'Manual', path: 'docs' }],
  history: 'full',
  commitMessages: 'subject',
  credential: null,
})

const disconnect = (cookies = admin) =>
  inject('POST', `/api/workspaces/${workspace}/source/disconnect`, cookies)

async function rendered(id: string): Promise<string> {
  const response = await inject('GET', `/api/documents/${id}/rendered`, viewer)
  expect(response.statusCode).toBe(200)
  return response.json<{ html: string }>().html
}

function push() {
  const body = JSON.stringify({ ref: 'refs/heads/main', after: 'ignored' })
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
  return harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspace}/source/webhooks/github`,
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': randomUUID(),
      'x-hub-signature-256': `sha256=${signature}`,
    },
    payload: body,
  })
}

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)

  root = await mkdtemp(join(tmpdir(), 'quill-source-disconnect-'))
  work = join(root, 'work')
  bare = join(root, 'manual.git')
  await mkdir(work)
  git(work, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  git(bare, ['config', 'uploadpack.allowFilter', 'true'])
  await commit('Write the manual', {
    'docs/start.md': '# Start here\n\nRead [the guide](guide.md) next.\n',
    'docs/guide.md': '# Guide\n\nThe guide as the repository wrote it.\n',
    'docs/gone.md': '# Gone page\n\nSoon to leave the repository.\n',
  })
  await setSecret(harness.deps, {
    name: WEBHOOK_SECRET_NAME,
    value: WEBHOOK_SECRET,
    actor: tenancy.admin,
  })

  const created = await inject('POST', '/api/workspaces', admin, {
    unitId: tenancy.unitId,
    name: 'Manual',
    slug: 'manual',
  })
  workspace = created.json<{ id: string }>().id
  const configured = await inject('PUT', `/api/workspaces/${workspace}/source`, admin, {
    ...SETTINGS(),
    webhookSecret: WEBHOOK_SECRET_NAME,
  })
  if (configured.statusCode !== 200) throw new Error(`not configured: ${configured.body}`)
  await harness.drainOutbox()
  await commit('Remove a page', { 'docs/gone.md': null })
  await inject('POST', `/api/workspaces/${workspace}/source/sync`)
  await harness.drainOutbox()
  startId = await idAt('docs/start.md')
  guideId = await idAt('docs/guide.md')
  goneId = await idAt('docs/gone.md')

  for (const [user, role] of [
    [tenancy.editor, 'editor'],
    [tenancy.viewer, 'viewer'],
  ] as const) {
    const granted = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: user,
      scopeKind: 'workspace',
      scopeId: workspace,
      role,
      effect: 'allow',
      createdBy: tenancy.admin,
    })
    if (granted.kind !== 'created') throw new Error(`grant refused: ${granted.kind}`)
  }
}, 90_000)

afterAll(async () => {
  await harness.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

describe('disconnecting a source', () => {
  it('is instance administration', async () => {
    expect((await disconnect(editor)).statusCode).toBe(403)
    expect((await inject('GET', `/api/workspaces/${workspace}`, editor)).json()).toMatchObject({
      origin: { kind: 'sourced' },
    })
  })

  it('makes the workspace native, and keeps the source as a record of where it came from', async () => {
    // A sync asked for before the disconnection, still waiting in the outbox when it lands.
    expect((await inject('POST', `/api/workspaces/${workspace}/source/sync`)).statusCode).toBe(202)
    const response = await disconnect()
    expect(response.statusCode).toBe(200)
    const record = response.json<{ disconnectedAt: string | null; remote: string }>()
    expect(record.disconnectedAt).toEqual(expect.any(String))
    expect(record.remote).toBe(pathToFileURL(bare).href)

    expect((await inject('GET', `/api/workspaces/${workspace}`, editor)).json()).toMatchObject({
      origin: { kind: 'native', disconnected: true },
    })
    const kept = await inject('GET', `/api/workspaces/${workspace}/source`)
    expect(kept.json()).toMatchObject({
      disconnectedAt: record.disconnectedAt,
      sync: { lastSyncedRevision: expect.any(String) },
    })
    const audit = await harness.database.pool.query<{ type: string }>(
      'SELECT type FROM audit_events WHERE type = $1',
      ['workspace.source_disconnected'],
    )
    expect(audit.rowCount).toBe(1)
    expect((await disconnect()).statusCode).toBe(409)
  })

  it('keeps every page, its id, its history and its address', async () => {
    const guide = await inject('GET', `/api/documents/${guideId}`, viewer)
    expect(guide.statusCode).toBe(200)
    expect(guide.json()).toMatchObject({ id: guideId, title: 'Guide' })
    const history = await inject('GET', `/api/documents/${guideId}/history`, viewer)
    expect(history.json<{ revisions: unknown[] }>().revisions).toHaveLength(1)
  })

  it('still draws a relative link in the stored text to the page it named', async () => {
    expect(await rendered(startId)).toContain(`href="/d/${guideId}"`)
  })

  it('still answers 410 for a page whose file had left the repository', async () => {
    const response = await inject('GET', `/api/documents/${goneId}`, viewer)
    expect(response.statusCode).toBe(410)
    expect(response.json()).toMatchObject({
      error: { code: 'document_removed', details: { title: 'Gone page' } },
    })
  })

  it('lets a person edit and publish a page that was read from the repository', async () => {
    const acquired = await inject('POST', `/api/documents/${guideId}/lock/acquire`, editor)
    expect(acquired.statusCode).toBe(200)
    // The editor opens the draft first, which starts one from the head (`openDraft`).
    const opened = await inject('GET', `/api/documents/${guideId}/draft`, editor)
    expect(opened.statusCode).toBe(200)
    const { frontMatter, ast } = parseDocument(
      '# Guide\n\nThe guide as people here write it now.\n',
    )
    const write = await inject('PUT', `/api/documents/${guideId}/draft`, editor, {
      ast: { version: 1, frontMatter, ast },
      expectedVersion: opened.json<{ draftVersion: number }>().draftVersion,
    })
    expect(write.statusCode).toBe(200)
    await inject('DELETE' as 'GET', `/api/documents/${guideId}/lock`, editor)
    const head = (await inject('GET', `/api/documents/${guideId}`, editor)).json<{
      headRevision: string
    }>().headRevision
    const published = await inject('POST', `/api/documents/${guideId}/publish`, editor, {
      base: head,
    })
    expect(published.statusCode).toBe(200)
    await harness.drainOutbox()

    expect(await rendered(guideId)).toContain('as people here write it now')
    const history = await inject('GET', `/api/documents/${guideId}/history`, viewer)
    expect(history.json<{ revisions: unknown[] }>().revisions).toHaveLength(2)
    // The page it was linked from still links to it.
    expect(await rendered(startId)).toContain(`href="/d/${guideId}"`)
  })

  it('never reads from the repository again', async () => {
    await commit('A change after the workspace left', {
      'docs/guide.md': '# Guide\n\nWhat the repository says now.\n',
    })
    const manual = await inject('POST', `/api/workspaces/${workspace}/source/sync`)
    expect(manual.statusCode).toBe(409)
    expect(manual.json()).toMatchObject({ error: { code: 'workspace_not_sourced' } })
    // Answered as a webhook for a source that does not exist.
    expect((await push()).statusCode).toBe(401)
    await harness.drainOutbox()
    expect(await rendered(guideId)).toContain('as people here write it now')

    const events = await harness.database.pool.query<{ type: string }>(
      'SELECT type FROM outbox_events WHERE type = $1',
      [SOURCE_DISCONNECTED],
    )
    expect(events.rowCount).toBe(1)
  })

  it('refuses to connect the workspace again, saying why', async () => {
    for (const url of [
      `/api/workspaces/${workspace}/source`,
      `/api/workspaces/${workspace}/source/preview`,
    ]) {
      const response = await inject(
        url.endsWith('preview') ? 'POST' : 'PUT',
        url,
        admin,
        SETTINGS(),
      )
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: { code: 'workspace_source_disconnected' } })
    }
  })
})
