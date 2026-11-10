import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createGrant } from '@quill/application'
import type { GrantId } from '@quill/application'
import type { DocumentId } from '@quill/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * A workspace's live stream, end to end (ADR-063): a real server listening on
 * a port, a real sync of a bare repository built here with `git`, and readers
 * who may see all of it, part of it, none of it, or another workspace.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let base: string
let workspaceId: string
/** A second workspace read from the same repository. */
let otherId: string
let cookies: Record<'admin' | 'viewer' | 'outsider', string>
let root: string
let work: string
let bare: string
let openId: DocumentId
let hiddenId: DocumentId
/** The viewer's grant on the workspace, revoked by the last test. */
let viewerGrant: GrantId

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

async function commit(message: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(work, path)), { recursive: true })
    await writeFile(join(work, path), content)
  }
  git(work, ['add', '--all'])
  git(work, ['commit', '--quiet', '--no-verify', '-m', message])
  git(work, ['push', '--quiet', bare, 'HEAD:refs/heads/main'])
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

interface LiveEvent {
  readonly event: string
  readonly data: Record<string, unknown>
}

/** One reader's stream, read as it arrives. */
interface Stream {
  readonly status: number
  readonly events: LiveEvent[]
  /** Every raw chunk, comments and the retry hint included. */
  readonly text: () => string
  readonly ended: () => boolean
  until(predicate: () => boolean, timeoutMs?: number): Promise<void>
  close(): void
}

/** Every stream a test opened, aborted before the server closes even if the test failed. */
const opened: AbortController[] = []

async function open(who: keyof typeof cookies, workspace = workspaceId): Promise<Stream> {
  const controller = new AbortController()
  const response = await fetch(`${base}/api/workspaces/${workspace}/events`, {
    headers: { cookie: cookies[who], accept: 'text/event-stream' },
    signal: controller.signal,
  })
  const events: LiveEvent[] = []
  let raw = ''
  let ended = false
  if (response.ok && response.body !== null) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          raw += decoder.decode(value, { stream: true })
          events.length = 0
          for (const block of raw.split('\n\n')) {
            const name = /^event: (.+)$/mu.exec(block)?.[1]
            const data = /^data: (.+)$/mu.exec(block)?.[1]
            if (name !== undefined && data !== undefined) {
              events.push({ event: name, data: JSON.parse(data) as Record<string, unknown> })
            }
          }
        }
      } catch {
        // Aborted by the test.
      }
      ended = true
    })()
  } else {
    raw = await response.text()
    ended = true
  }
  opened.push(controller)
  return {
    status: response.status,
    events,
    text: () => raw,
    ended: () => ended,
    async until(predicate, timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out; the stream holds: ${raw}`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    },
    close() {
      controller.abort()
    },
  }
}

const finished = (s: Stream) => () =>
  s.events.some((e) => e.event === 'sync' && e.data['state'] === 'finished')

const documents = (s: Stream) =>
  s.events.filter((e) => e.event === 'document').map((e) => e.data['documentId'])

const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

async function idAt(title: string): Promise<DocumentId> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${workspaceId}/documents`,
    cookies: await harness.cookiesFor(tenancy.admin),
  })
  const found = response.json<{ id: string; title: string }[]>().find((d) => d.title === title)
  if (found === undefined) throw new Error(`no document titled ${title}`)
  return found.id as DocumentId
}

beforeAll(async () => {
  harness = await createServerHarness({ live: { flushMs: 20, heartbeatMs: 150, maxPerReader: 2 } })
  tenancy = await seedTenancy(harness)
  cookies = {
    admin: cookieHeader(await harness.cookiesFor(tenancy.admin)),
    viewer: cookieHeader(await harness.cookiesFor(tenancy.viewer)),
    outsider: cookieHeader(await harness.cookiesFor(tenancy.outsider)),
  }
  await harness.app.listen({ host: '127.0.0.1', port: 0 })
  base = `http://127.0.0.1:${(harness.app.server.address() as AddressInfo).port}`

  root = await mkdtemp(join(tmpdir(), 'quill-live-'))
  work = join(root, 'work')
  bare = join(root, 'handbook.git')
  await mkdir(work)
  git(work, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  git(bare, ['config', 'uploadpack.allowFilter', 'true'])
  await commit('Write the handbook', {
    'docs/open.md': '# Open page\n\nFor everyone.\n',
    'docs/hidden.md': '# Hidden page\n\nNot for the viewer.\n',
  })

  const admin = await harness.cookiesFor(tenancy.admin)
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/workspaces',
    cookies: admin,
    payload: { unitId: tenancy.unitId, name: 'Live handbook', slug: 'live-handbook' },
  })
  workspaceId = created.json<{ id: string }>().id
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
  if (configured.statusCode !== 200) throw new Error(`not configured: ${configured.body}`)
  // A second workspace read from the same repository, which the viewer may read too.
  otherId = (
    await harness.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: admin,
      payload: { unitId: tenancy.unitId, name: 'Other handbook', slug: 'other-handbook' },
    })
  ).json<{ id: string }>().id
  const other = await harness.app.inject({
    method: 'PUT',
    url: `/api/workspaces/${otherId}/source`,
    cookies: admin,
    payload: {
      remote: pathToFileURL(bare).href,
      branch: 'main',
      collections: [{ slug: 'docs', name: 'Docs', path: 'docs' }],
      history: 'head',
      commitMessages: 'subject',
      credential: null,
    },
  })
  if (other.statusCode !== 200) throw new Error(`not configured: ${other.body}`)
  await harness.drainOutbox()
  openId = await idAt('Open page')
  hiddenId = await idAt('Hidden page')

  // The viewer may read the workspace, but not the hidden page; the outsider nothing.
  for (const grant of [
    { scopeKind: 'workspace', scopeId: otherId, effect: 'allow' },
    { scopeKind: 'workspace', scopeId: workspaceId, effect: 'allow' },
    { scopeKind: 'document', scopeId: hiddenId, effect: 'deny' },
  ] as const) {
    const granted = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.viewer,
      role: 'viewer',
      createdBy: tenancy.admin,
      ...grant,
    })
    if (granted.kind !== 'created') throw new Error(`grant refused: ${granted.kind}`)
    if (grant.scopeId === workspaceId) viewerGrant = granted.grant.id
  }
}, 60_000)

afterAll(async () => {
  for (const controller of opened) controller.abort()
  // The test's own client keeps idle sockets for reuse; the server is not waited on for them.
  harness.app.server.closeAllConnections()
  await harness.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

describe('a workspace’s live stream', () => {
  it('tells each reader of a sync what they may see, and only that', async () => {
    const admin = await open('admin')
    const viewer = await open('viewer')
    expect(admin.status).toBe(200)
    expect(viewer.status).toBe(200)
    await viewer.until(() => viewer.text().includes('retry: '))

    await commit('Revise both pages', {
      'docs/open.md': '# Open page\n\nFor everyone, revised.\n',
      'docs/hidden.md': '# Hidden page\n\nStill not for the viewer, revised.\n',
    })
    await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/source/sync`,
      cookies: await harness.cookiesFor(tenancy.admin),
    })
    await harness.drainOutbox()

    await admin.until(finished(admin))
    await viewer.until(finished(viewer))
    await settle()

    expect(documents(admin).toSorted()).toEqual([hiddenId, openId].toSorted())
    expect(documents(viewer)).toEqual([openId])
    expect(viewer.text()).not.toContain(hiddenId)
    expect(viewer.events.find((e) => e.event === 'sync' && e.data['state'] === 'finished')).toEqual(
      {
        event: 'sync',
        data: { state: 'finished', changed: true },
      },
    )
    // Ids and a revision, never a title or a path.
    expect(viewer.text()).not.toContain('Open page')
    expect(viewer.text()).not.toContain('docs/')

    admin.close()
    viewer.close()
  })

  it('gives a reader without access nothing: not a stream, not a word', async () => {
    const outsider = await open('outsider')
    // Refused as every workspace route refuses it, before anything is written.
    expect(outsider.status).toBe(403)
    expect(outsider.text()).not.toContain('retry:')
    expect(outsider.events).toEqual([])
    expect(harness.deps.live.size()).toBe(0)
  })

  it('tells a reader of another workspace nothing of this one', async () => {
    const elsewhere = await open('viewer', otherId)
    expect(elsewhere.status).toBe(200)
    await commit('Revise the open page', { 'docs/open.md': '# Open page\n\nAgain.\n' })
    await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/source/sync`,
      cookies: await harness.cookiesFor(tenancy.admin),
    })
    await harness.drainOutbox()
    await settle()
    expect(elsewhere.events).toEqual([])
    elsewhere.close()
  })

  it('opens no stream for a workspace that reads from no repository', async () => {
    const native = await open('viewer', tenancy.workspaceId)
    expect(native.status).toBe(409)
    expect(native.text()).not.toContain('retry:')
    expect(harness.deps.live.size()).toBe(0)
  })

  it('keeps a quiet stream open with comments, and bounds how many one reader holds', async () => {
    const first = await open('viewer')
    const second = await open('viewer')
    const third = await open('viewer')
    expect([first.status, second.status, third.status]).toEqual([200, 200, 429])
    await first.until(() => first.text().includes(': keep-alive'))
    first.close()
    second.close()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(harness.deps.live.size()).toBe(0)
  })

  it('ends the stream of a reader who signs out', async () => {
    const viewer = await open('viewer')
    expect(viewer.status).toBe(200)
    await viewer.until(() => viewer.text().includes('retry: '))
    await harness.deps.uow.repos.sessions.deleteAllForUser(tenancy.viewer)
    await viewer.until(() => viewer.ended())
    expect(viewer.events).toEqual([])
    cookies.viewer = cookieHeader(await harness.cookiesFor(tenancy.viewer))
  })

  it('ends the stream of a reader who loses access while it is open', async () => {
    const viewer = await open('viewer')
    expect(viewer.status).toBe(200)
    await viewer.until(() => viewer.text().includes('retry: '))
    await harness.deps.uow.repos.grants.delete(viewerGrant)
    // The next heartbeat finds the workspace gone from what the viewer may read.
    await viewer.until(() => viewer.ended())
    expect(viewer.events).toEqual([])
    expect(harness.deps.live.size()).toBe(0)
  })
  it('ends every stream when the source is disconnected, and opens no more', async () => {
    const admin = await open('admin')
    expect(admin.status).toBe(200)
    await admin.until(() => admin.text().includes('retry: '))
    const disconnected = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/source/disconnect`,
      cookies: await harness.cookiesFor(tenancy.admin),
    })
    expect(disconnected.statusCode).toBe(200)
    await admin.until(() => admin.ended())
    // Ended without a word: the disconnection is not itself told.
    expect(admin.events).toEqual([])
    expect(harness.deps.live.size()).toBe(0)
    const again = await open('admin')
    expect(again.status).toBe(409)
    expect(harness.deps.live.size()).toBe(0)
  })
})
