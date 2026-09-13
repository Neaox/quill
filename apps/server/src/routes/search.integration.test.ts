import { createGrant } from '@quill/application'
import { collectionId as toCollectionId, workspaceId as toWorkspaceId } from '@quill/domain'
import type { CollectionId, DocumentId, WorkspaceId } from '@quill/domain'
import { parseDocument } from '@quill/markdown'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { reindex } from '../scripts/reindex.ts'
import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Search end to end (ADR-010, use case 20): publish a document, let the outbox
 * consumer index it, and find it through `GET /api/search` — with the snippet,
 * the link, the breadcrumb, the current workspace's results first and other
 * workspaces grouped below, and nothing a reader may not read.
 *
 * Everything here goes through the real PostgreSQL adapter against the test
 * schema, the real outbox poller, and the real Markdown pipeline, because the
 * whole point of the milestone is that those three agree.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>
let marketing: WorkspaceId
let campaigns: CollectionId

const RUNBOOK = [
  '# Database failover runbook',
  '',
  'When the primary database stops answering, promote the standby replica.',
  '',
  '## Promote the replica',
  '',
  'The failover takes about four minutes.',
].join('\n')

const ONBOARDING = [
  '---',
  'status: draft',
  'tags:',
  '  - Guide',
  'owners:',
  '  - Ada Lovelace',
  '---',
  '',
  '# Onboarding guide',
  '',
  'Welcome to the team. Read the failover runbook on your first day.',
].join('\n')

const CAMPAIGN = [
  '# Launch campaign',
  '',
  'The campaign database holds every prospect we have spoken to.',
].join('\n')

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)

  const { repos } = harness.deps.uow
  const now = harness.clock.now()
  const workspace = await repos.workspaces.create({
    id: toWorkspaceId(harness.deps.ids.uuid()),
    unitId: tenancy.unitId,
    name: 'Marketing',
    slug: 'marketing',
    now,
  })
  marketing = workspace.id as WorkspaceId
  const collection = await repos.collections.create({
    id: toCollectionId(harness.deps.ids.uuid()),
    workspaceId: marketing,
    name: 'Campaigns',
    slug: 'campaigns',
    now,
  })
  campaigns = collection.id as CollectionId

  for (const user of [tenancy.editor, tenancy.viewer]) {
    const granted = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: user,
      scopeKind: 'workspace',
      scopeId: marketing,
      role: 'editor',
      effect: 'allow',
      createdBy: tenancy.admin,
    })
    /* v8 ignore next -- the fixture's grants are valid by construction. */
    if (granted.kind !== 'created') throw new Error(`fixture grant rejected: ${granted.kind}`)
  }
}, 60_000)

afterAll(async () => {
  await harness.close()
})

async function createDocument(
  title: string,
  workspaceId: WorkspaceId,
  collectionId: CollectionId,
): Promise<DocumentId> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspaceId}/documents`,
    cookies: editor,
    payload: { collectionId, title },
  })
  expect(response.statusCode).toBe(201)
  return response.json().document.id as DocumentId
}

/** Create, draft, publish, and let the outbox run — what a writer's whole day amounts to. */
async function publishDocument(
  title: string,
  markdown: string,
  workspaceId: WorkspaceId = tenancy.workspaceId,
  collectionId: CollectionId = tenancy.collectionId,
): Promise<DocumentId> {
  const id = await createDocument(title, workspaceId, collectionId)
  const acquired = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/lock/acquire`,
    cookies: editor,
  })
  expect(acquired.statusCode).toBe(200)

  const { frontMatter, ast } = parseDocument(markdown)
  const written = await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    cookies: editor,
    payload: { ast: { version: 1, frontMatter, ast }, expectedVersion: 0 },
  })
  expect(written.statusCode).toBe(200)
  await harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/lock`, cookies: editor })

  const published = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/publish`,
    cookies: editor,
    payload: { base: null },
  })
  expect(published.statusCode).toBe(200)

  await harness.drainOutbox()
  return id
}

interface SearchHitResponse {
  readonly documentId: string
  readonly shortId: string
  readonly slug: string
  readonly title: string
  readonly path: string
  readonly breadcrumb: readonly string[]
  readonly snippet: { readonly text: string; readonly ranges: readonly unknown[] }
  readonly score: number
}

interface SearchResponse {
  readonly query: string
  readonly current: readonly SearchHitResponse[]
  readonly elsewhere: readonly {
    readonly workspace: { readonly id: string; readonly slug: string; readonly name: string }
    readonly hits: readonly SearchHitResponse[]
  }[]
  readonly nextCursor?: string
}

async function search(
  query: string,
  cookies: Record<string, string> = editor,
  extra: Record<string, string> = {},
) {
  const parameters = new URLSearchParams({ q: query, ...extra })
  return harness.app.inject({ method: 'GET', url: `/api/search?${parameters.toString()}`, cookies })
}

function titles(response: SearchResponse): readonly string[] {
  return [
    ...response.current.map((hit) => hit.title),
    ...response.elsewhere.flatMap((group) => group.hits.map((hit) => hit.title)),
  ]
}

let runbook: DocumentId
let onboarding: DocumentId
let campaign: DocumentId

describe('finding a document', () => {
  beforeAll(async () => {
    runbook = await publishDocument('Database failover runbook', RUNBOOK)
    onboarding = await publishDocument('Onboarding guide', ONBOARDING)
    campaign = await publishDocument('Launch campaign', CAMPAIGN, marketing, campaigns)
  }, 60_000)

  it('finds a newly published revision, with a snippet and everything a link needs', async () => {
    const response = await search('failover', editor, { workspace: tenancy.workspaceId })
    expect(response.statusCode).toBe(200)

    const body = response.json() as SearchResponse
    const hit = body.current.find((candidate) => candidate.documentId === runbook)
    expect(hit).toBeDefined()
    expect(hit?.title).toBe('Database failover runbook')
    expect(hit?.shortId).toHaveLength(10)
    expect(hit?.slug.length).toBeGreaterThan(0)
    expect(hit?.breadcrumb).toEqual(['Engineering', 'Architecture'])
    expect(hit?.snippet.text).toContain('failover')
    expect(hit?.snippet.ranges.length).toBeGreaterThan(0)
  })

  it('puts the current workspace first and groups every other one below it', async () => {
    const response = await search('database', editor, { workspace: 'marketing' })
    const body = response.json() as SearchResponse

    expect(body.current.map((hit) => hit.documentId)).toContain(campaign)
    const elsewhere = body.elsewhere.find((group) => group.workspace.slug === 'engineering')
    expect(elsewhere?.workspace.name).toBe('Engineering')
    expect(elsewhere?.hits.map((hit) => hit.documentId)).toContain(runbook)
  })

  it('offers every readable workspace as a suggestion when no workspace is named', async () => {
    const body = (await search('database')).json() as SearchResponse
    expect(body.current).toEqual([])
    expect(body.elsewhere.length).toBeGreaterThanOrEqual(2)
  })

  it('filters on front matter the publish wrote', async () => {
    const byTag = (
      await search('tag:guide', editor, { workspace: tenancy.workspaceId })
    ).json() as SearchResponse
    expect(byTag.current.map((hit) => hit.documentId)).toEqual([onboarding])

    const byOwner = (
      await search('owner:"ada lovelace"', editor, {
        workspace: tenancy.workspaceId,
      })
    ).json() as SearchResponse
    expect(byOwner.current.map((hit) => hit.documentId)).toEqual([onboarding])

    const byStatus = (
      await search('status:draft', editor, { workspace: tenancy.workspaceId })
    ).json() as SearchResponse
    expect(byStatus.current.map((hit) => hit.documentId)).toEqual([onboarding])
  })

  it('searches the title alone when asked to', () => {
    return search('title:failover', editor, { workspace: tenancy.workspaceId }).then((response) => {
      const body = response.json() as SearchResponse
      expect(body.current.map((hit) => hit.documentId)).toEqual([runbook])
    })
  })

  it('finds a renamed document under its new title, because a rename re-indexes', async () => {
    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${onboarding}`,
      // Renaming is management, not editing (ADR-012), so it is the admin who
      // does it — the point of the test is what happens afterwards.
      cookies: admin,
      payload: { title: 'Induction handbook' },
    })
    expect(renamed.statusCode).toBe(200)
    await harness.drainOutbox()

    const body = (
      await search('induction', editor, { workspace: tenancy.workspaceId })
    ).json() as SearchResponse
    expect(titles(body)).toContain('Induction handbook')
  })

  it('never shows a document the reader is denied, even when its title matches', async () => {
    const denied = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.viewer,
      scopeKind: 'document',
      scopeId: runbook,
      role: 'viewer',
      effect: 'deny',
      createdBy: tenancy.admin,
    })
    expect(denied.kind).toBe('created')

    const asViewer = (await search('database failover runbook', viewer)).json() as SearchResponse
    expect(titles(asViewer)).not.toContain('Database failover runbook')

    const asEditor = (await search('database failover runbook', editor)).json() as SearchResponse
    expect(titles(asEditor)).toContain('Database failover runbook')
  })

  it('shows somebody with no grant nothing at all', async () => {
    const body = (await search('database', outsider)).json() as SearchResponse
    expect(body).toMatchObject({ current: [], elsewhere: [] })
  })

  it('pages, and hands back a cursor that works', async () => {
    const first = (await search('database', editor, { limit: '1' })).json() as SearchResponse
    expect(titles(first)).toHaveLength(1)
    expect(first.nextCursor).toBeDefined()

    const second = (
      await search('database', editor, {
        limit: '1',
        cursor: String(first.nextCursor),
      })
    ).json() as SearchResponse
    expect(titles(second)[0]).not.toBe(titles(first)[0])
  })

  it('says where a malformed query went wrong', async () => {
    const response = await search('"never closed')
    expect(response.statusCode).toBe(422)
    expect(response.json().error).toMatchObject({
      code: 'invalid_query',
      details: { kind: 'unterminated-quote', position: 0 },
    })
  })

  it('refuses a cursor it did not write', async () => {
    const response = await search('database', editor, { cursor: 'not-a-cursor' })
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('invalid_cursor')
  })

  it('refuses a workspace the caller cannot read as one that is not there', async () => {
    const response = await search('database', outsider, { workspace: 'marketing' })
    expect(response.statusCode).toBe(404)
  })

  it('needs a session', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/search?q=database' })
    expect(response.statusCode).toBe(401)
  })

  it('refuses a query that only says what to leave out', async () => {
    const response = await search('-draft -archive')
    expect(response.statusCode).toBe(422)
    expect(response.json().error).toMatchObject({
      code: 'invalid_query',
      details: { kind: 'nothing-to-search-for' },
    })
  })

  it('refuses an empty query rather than listing everything the caller may read', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/search?q=',
      cookies: editor,
    })
    expect(response.statusCode).toBe(400)
  })

  it('validates the query string rather than trusting it', async () => {
    expect(
      (await harness.app.inject({ method: 'GET', url: '/api/search', cookies: editor })).statusCode,
    ).toBe(400)
    expect((await search('database', editor, { limit: '500' })).statusCode).toBe(400)
  })

  it('rebuilds everything it can find from the content store (quill reindex)', async () => {
    for (const id of [runbook, onboarding, campaign]) {
      await harness.deps.searchIndex.remove(id)
    }
    expect(titles((await search('database')).json() as SearchResponse)).toEqual([])

    const result = await reindex(harness.deps, { render: true })
    expect(result.workspaces).toBe(2)
    expect(result.indexed).toBeGreaterThanOrEqual(3)
    expect(result.rendered).toBe(result.indexed)

    expect(titles((await search('database')).json() as SearchResponse).length).toBeGreaterThan(0)
  }, 60_000)

  it('rebuilds one workspace, and an unknown one rebuilds nothing', async () => {
    expect(await reindex(harness.deps, { workspaceId: marketing })).toMatchObject({
      workspaces: 1,
      rendered: 0,
    })
    expect(
      await reindex(harness.deps, {
        workspaceId: '00000000-0000-4000-8000-0000000000ff' as WorkspaceId,
      }),
    ).toEqual({ workspaces: 0, indexed: 0, removed: 0, rendered: 0 })
  }, 60_000)

  it('takes a document out of the index when it has nothing published, and reports it', async () => {
    const unpublished = await createDocument(
      'Never published',
      tenancy.workspaceId,
      tenancy.collectionId,
    )
    await harness.drainOutbox()

    const result = await reindex(harness.deps, { workspaceId: tenancy.workspaceId })
    expect(result.removed).toBeGreaterThanOrEqual(1)
    expect(titles((await search('never published')).json() as SearchResponse)).not.toContain(
      'Never published',
    )
    expect(unpublished).toBeDefined()
  }, 60_000)
})
