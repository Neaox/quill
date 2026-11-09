import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { setSecret } from '@quill/application'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Keeping a sourced workspace fresh, end to end (ADR-061, "Freshness"): a
 * signed push webhook, the daily reconciliation, and the administrators told
 * once when a sync stops. The repository is a bare one built here with the
 * `git` CLI and read through the real adapter, lock and outbox lane.
 */

const WEBHOOK_SECRET_NAME = 'sources/handbook-webhook'
const WEBHOOK_SECRET = 'a-shared-webhook-secret'

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
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

async function commit(message: string, files: Readonly<Record<string, string>>): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(work, path)), { recursive: true })
    await writeFile(join(work, path), content)
  }
  git(work, ['add', '--all'])
  git(work, ['commit', '--quiet', '--no-verify', '-m', message])
  git(work, ['push', '--quiet', bare, 'HEAD:refs/heads/main'])
  return git(work, ['rev-parse', 'HEAD'])
}

/** A GitHub push delivery for `workspace`, signed with `secret`. */
function push(
  options: {
    readonly workspace?: string
    readonly secret?: string
    readonly ref?: string
    readonly delivery?: string
    readonly event?: string
  } = {},
) {
  const body = JSON.stringify({ ref: options.ref ?? 'refs/heads/main', after: 'ignored' })
  const signature = createHmac('sha256', options.secret ?? WEBHOOK_SECRET)
    .update(body)
    .digest('hex')
  return harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${options.workspace ?? tenancy.workspaceId}/source/webhooks/github`,
    headers: {
      'content-type': 'application/json',
      'x-github-event': options.event ?? 'push',
      'x-github-delivery': options.delivery ?? randomUUID(),
      'x-hub-signature-256': `sha256=${signature}`,
    },
    payload: body,
  })
}

function source() {
  return harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${tenancy.workspaceId}/source`,
    cookies: admin,
  })
}

async function documentTitles(): Promise<string[]> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: admin,
  })
  return response
    .json<{ title: string }[]>()
    .map(({ title }) => title)
    .toSorted()
}

async function notificationsOf(cookies: Record<string, string>) {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/me/notifications',
    cookies,
  })
  expect(response.statusCode).toBe(200)
  return response.json<{ items: { kind: string }[]; unread: number }>()
}

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)

  root = await mkdtemp(join(tmpdir(), 'quill-source-freshness-'))
  work = join(root, 'work')
  bare = join(root, 'handbook.git')
  await mkdir(work)
  git(work, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  git(bare, ['config', 'uploadpack.allowFilter', 'true'])
  await commit('Add the setup guide', { 'docs/guides/setup.md': '# Setup\n\nInstall.\n' })

  await setSecret(harness.deps, {
    name: WEBHOOK_SECRET_NAME,
    value: WEBHOOK_SECRET,
    actor: tenancy.admin,
  })
}, 60_000)

afterAll(async () => {
  await harness.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

describe('the push webhook', () => {
  it('names its secret when the source is configured, and syncs the first time', async () => {
    const configured = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${tenancy.workspaceId}/source`,
      cookies: admin,
      payload: {
        remote: pathToFileURL(bare).href,
        branch: 'main',
        collections: [{ slug: 'guides', name: 'Guides', path: 'docs/guides' }],
        history: 'full',
        commitMessages: 'subject',
        credential: null,
        webhookSecret: WEBHOOK_SECRET_NAME,
      },
    })
    expect(configured.statusCode).toBe(200)
    expect(configured.json()).toMatchObject({ webhookSecret: WEBHOOK_SECRET_NAME })
    await harness.drainOutbox()
    expect(await documentTitles()).toEqual(['Setup'])
  })

  it('refuses a secret that is not stored, naming the setting', async () => {
    const refused = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${tenancy.workspaceId}/source`,
      cookies: admin,
      payload: {
        remote: pathToFileURL(bare).href,
        branch: 'main',
        collections: [{ slug: 'guides', name: 'Guides', path: 'docs/guides' }],
        history: 'full',
        commitMessages: 'subject',
        credential: null,
        webhookSecret: 'sources/missing',
      },
    })
    expect(refused.statusCode).toBe(422)
    expect(refused.json()).toMatchObject({
      error: { code: 'invalid_source', details: { field: 'webhookSecret' } },
    })
  })

  it('brings a push in from a signed delivery, and once per delivery', async () => {
    const pushed = await commit('Add the release guide', {
      'docs/guides/release.md': '# Release\n\nTag it.\n',
    })
    const delivery = randomUUID()
    const accepted = await push({ delivery })
    expect(accepted.statusCode).toBe(202)
    expect(accepted.json()).toEqual({ outcome: 'requested' })
    expect((await push({ delivery })).json()).toEqual({ outcome: 'duplicate' })

    await harness.drainOutbox()
    expect(await documentTitles()).toEqual(['Release', 'Setup'])
    expect((await source()).json()).toMatchObject({ sync: { lastSyncedRevision: pushed } })
  })

  it('accepts and ignores other events and other branches', async () => {
    expect((await push({ event: 'ping' })).json()).toEqual({ outcome: 'ignored' })
    expect((await push({ ref: 'refs/heads/release' })).json()).toEqual({ outcome: 'ignored' })
  })

  it('refuses what it cannot verify with one answer, whoever asks about whichever workspace', async () => {
    const native = await harness.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: admin,
      payload: { unitId: tenancy.unitId, name: 'Native', slug: 'native-webhook' },
    })
    const refusals = await Promise.all([
      push({ secret: 'a-guess' }),
      push({ workspace: native.json<{ id: string }>().id }),
      push({ workspace: randomUUID() }),
      push({ workspace: 'not-a-workspace' }),
    ])
    const bodies = new Set(refusals.map((response) => response.body))
    expect(refusals.map((response) => response.statusCode)).toEqual([401, 401, 401, 401])
    expect(bodies.size).toBe(1)
    expect(refusals[0]?.json()).toMatchObject({ error: { code: 'invalid_signature' } })
  })

  it('answers 400 to a signed delivery with no ref, and 404 to a forge it does not read', async () => {
    const body = JSON.stringify({ zen: 'Keep it logically awesome.' })
    const signed = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/source/webhooks/github`,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': randomUUID(),
        'x-hub-signature-256': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`,
      },
      payload: body,
    })
    expect(signed.statusCode).toBe(400)
    expect(signed.json()).toMatchObject({ error: { code: 'invalid_delivery' } })

    const bitbucket = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/source/webhooks/bitbucket`,
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    })
    expect([400, 404]).toContain(bitbucket.statusCode)
  })

  it('refuses a delivery with no body and repeated headers like any other', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/source/webhooks/github`,
      headers: { 'x-github-event': 'push', 'set-cookie': ['a=1', 'b=2'] },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'invalid_signature' } })
  })

  it('accepts a GitLab push carrying the secret', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/source/webhooks/gitlab`,
      headers: {
        'content-type': 'application/json',
        'x-gitlab-event': 'Push Hook',
        'x-gitlab-token': WEBHOOK_SECRET,
        'idempotency-key': randomUUID(),
      },
      payload: JSON.stringify({ ref: 'refs/heads/main' }),
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ outcome: 'requested' })
    await harness.drainOutbox()
  })
})

describe('the daily reconciliation', () => {
  it('brings in a push no webhook announced', async () => {
    const pushed = await commit('Add the support guide', {
      'docs/guides/support.md': '# Support\n\nAsk.\n',
    })
    harness.clock.advance(harness.deps.config.sources.reconcileIntervalMs)
    expect(await harness.jobRunner.runDueJobs()).toContain('reconcile-sources')
    await harness.drainOutbox()
    expect(await documentTitles()).toEqual(['Release', 'Setup', 'Support'])
    expect((await source()).json()).toMatchObject({ sync: { lastSyncedRevision: pushed } })
  })
})

describe('a sync that stops', () => {
  it('tells the administrators once, not once per attempt, and nobody else', async () => {
    await commit('Break the manifest', { '.quill/workspace.yaml': 'version: 1\ncollections: [\n' })
    expect((await push()).json()).toEqual({ outcome: 'requested' })
    await harness.drainOutbox()
    expect((await push()).json()).toEqual({ outcome: 'requested' })
    await harness.drainOutbox()

    expect((await source()).json()).toMatchObject({
      sync: { failure: { reason: 'invalid-manifest' } },
    })
    const told = await notificationsOf(admin)
    expect(told.items).toEqual([
      expect.objectContaining({
        kind: 'source-sync-failed',
        workspace: expect.objectContaining({ id: tenancy.workspaceId }),
        failure: expect.objectContaining({ reason: 'invalid-manifest' }),
      }),
    ])
    expect((await notificationsOf(editor)).items).toEqual([])
  })
})

describe('the rate limit', () => {
  it('stops an address that keeps delivering', async () => {
    const statuses: number[] = []
    for (let attempt = 0; attempt < 70; attempt += 1) {
      statuses.push((await push({ secret: 'a-guess' })).statusCode)
    }
    expect(statuses).toContain(429)
  })
})
