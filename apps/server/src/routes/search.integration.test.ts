import { createGrant } from '@quill/application'
import {
  collectionId as toCollectionId,
  groupId as toGroupId,
  revisionId as toRevisionId,
  userId as toUserId,
  workspaceId as toWorkspaceId,
} from '@quill/domain'
import type { CollectionId, DocumentId, WorkspaceId } from '@quill/domain'
import { parseDocument } from '@quill/markdown'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { reindex } from '../scripts/reindex.ts'
import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'
import { drawioFixture } from '../test-support/drawio-fixture.ts'

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
  await publishMarkdown(id, markdown)
  return id
}

/** Draft and publish a document that already exists, and let the outbox run. */
async function publishMarkdown(id: DocumentId, markdown: string): Promise<void> {
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
  readonly status: string
  readonly updatedAt: string
  readonly tags: readonly string[]
  readonly contributors: readonly { readonly name: string }[]
  readonly contributorCount: number
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

/** The documents a response offers, in the order it offers them: the current workspace's first. */
function idsOf(response: SearchResponse): readonly string[] {
  return [
    ...response.current.map((hit) => hit.documentId),
    ...response.elsewhere.flatMap((group) => group.hits.map((hit) => hit.documentId)),
  ]
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

describe('finding what somebody has published (by: and team:)', () => {
  const asked = async (query: string, cookies = editor) =>
    idsOf((await search(query, cookies)).json() as SearchResponse)

  beforeAll(async () => {
    // The editor's whole team: a group they belong to, so `team:` has someone to find.
    const { repos } = harness.deps.uow
    const group = await repos.groups.create({
      id: toGroupId(harness.deps.ids.uuid()),
      unitId: tenancy.unitId,
      parentGroupId: null,
      name: 'Writers',
      now: harness.clock.now(),
    })
    await repos.groups.addMember({
      groupId: group.id,
      userId: tenancy.editor,
      now: harness.clock.now(),
    })
  })

  it('finds everything somebody published, by their name', async () => {
    const found = await asked('by:editor')
    expect(found).toEqual(expect.arrayContaining([runbook, onboarding, campaign]))
  })

  it('finds it by their address, and by me when the person asking is them', async () => {
    expect(await asked('by:editor@example.com')).toEqual(expect.arrayContaining([runbook]))
    expect(await asked('by:me')).toEqual(expect.arrayContaining([runbook, onboarding]))
  })

  it('reads me as the person asking, so somebody who published nothing finds nothing', async () => {
    expect(await asked('by:me', viewer)).toEqual([])
  })

  it('finds what any member of a team published', async () => {
    expect(await asked('team:writers')).toEqual(expect.arrayContaining([runbook, onboarding]))
    expect(await asked('team:no-such-team')).toEqual([])
  })

  it('combines with the words and the other filters, and can leave a person out', async () => {
    expect(await asked('failover by:editor')).toEqual(expect.arrayContaining([runbook]))
    expect(await asked('failover -by:editor')).not.toContain(runbook)
  })

  it('names nobody who published only what the person asking may not read', async () => {
    // The outsider has no grant anywhere: whoever published, they find nothing.
    expect(await asked('by:editor', outsider)).toEqual([])
  })

  it('still finds them after the index is rebuilt from the content store', async () => {
    await reindex(harness.deps)
    expect(await asked('by:editor')).toEqual(expect.arrayContaining([runbook, onboarding]))
    expect(await asked('team:writers')).toEqual(expect.arrayContaining([runbook]))
  })
})

describe('finding a draw.io diagram by its labels (ADR-043)', () => {
  const BOUNDARY = 'quillboundary'

  function multipart(bytes: Buffer) {
    const head =
      `--${BOUNDARY}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="flow.drawio.svg"\r\n' +
      'Content-Type: image/svg+xml\r\n\r\n'
    return {
      payload: Buffer.concat([Buffer.from(head), bytes, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    }
  }

  it('finds a published document by a word that is only in its diagram, before and after a re-save', async () => {
    const id = await createDocument('Payment flow', tenancy.workspaceId, tenancy.collectionId)
    const uploaded = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/attachments`,
      cookies: editor,
      ...multipart(drawioFixture('Reconciliationengine')),
    })
    expect(uploaded.statusCode).toBe(201)
    const attachment = uploaded.json() as { id: string; url: string }
    await publishMarkdown(id, `# Payment flow\n\n![How a payment moves](${attachment.url})\n`)

    expect(titles((await search('reconciliationengine')).json() as SearchResponse)).toContain(
      'Payment flow',
    )

    const revised = await harness.app.inject({
      method: 'PUT',
      url: `/api/attachments/${attachment.id}?expectedVersion=1`,
      cookies: editor,
      ...multipart(drawioFixture('Settlementledger')),
    })
    expect(revised.statusCode).toBe(200)
    await harness.drainOutbox()

    expect(titles((await search('settlementledger')).json() as SearchResponse)).toContain(
      'Payment flow',
    )
    expect(titles((await search('reconciliationengine')).json() as SearchResponse)).not.toContain(
      'Payment flow',
    )
  }, 60_000)
})

/**
 * What a result row shows of the document (ADR-010, amendment of 2026-10-17):
 * its status, when it changed, its first tags, and who has published it -
 * names only - all without a query per hit.
 */
describe('what a result row says about the document', () => {
  let crowded: DocumentId

  const hitFor = async (id: DocumentId, query: string, cookies = editor) => {
    const body = (await search(query, cookies)).json() as SearchResponse
    return [...body.current, ...body.elsewhere.flatMap((group) => group.hits)].find(
      (hit) => hit.documentId === id,
    )
  }

  beforeAll(async () => {
    crowded = await createDocument(
      'Crowded notes about hedgehogs',
      tenancy.workspaceId,
      tenancy.collectionId,
    )
    // Four more people publishing, later than the editor, one of whom the
    // tool that wrote the revision knew only by an address.
    const { repos } = harness.deps.uow
    const later = harness.clock.now().getTime()
    for (const [at, name, email] of [
      [1, 'Ada Lovelace', 'ada@example.com'],
      [2, 'sam@example.com', 'sam@example.com'],
      [3, 'Grace Hopper', 'grace@example.com'],
      [4, 'Alan Turing', 'alan@example.com'],
    ] as const) {
      await repos.revisions.append({
        id: `crowded-${at}`,
        documentId: crowded,
        workspaceId: tenancy.workspaceId,
        revision: toRevisionId((0xc0de00 + at).toString(16).padStart(40, '0')),
        authorName: name,
        authorEmail: email,
        timestamp: new Date(later + at * 3_600_000),
        summary: `Revision ${at}`,
        changeNote: null,
        now: harness.clock.now(),
      })
    }
    await publishMarkdown(
      crowded,
      [
        '---',
        'tags:',
        ...['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].map((tag) => `  - ${tag}`),
        '---',
        '',
        '# Crowded notes about hedgehogs',
        '',
        'Hedgehogs are crowded.',
      ].join('\n'),
    )
  }, 60_000)

  it('carries the status, the last update and the tags of the document', async () => {
    const hit = await hitFor(runbook, 'failover')
    expect(hit?.status).toBe('published')
    expect(hit?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    expect(Number.isNaN(Date.parse(hit?.updatedAt ?? ''))).toBe(false)
    expect(hit?.tags).toEqual([])

    expect((await hitFor(onboarding, 'induction'))?.tags).toEqual(['guide'])
  })

  it('keeps five tags, in the order the document stores them', async () => {
    expect((await hitFor(crowded, 'hedgehogs'))?.tags).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ])
  })

  it('names three people, most recent publisher first, and counts all of them', async () => {
    const hit = await hitFor(crowded, 'hedgehogs')
    expect(hit?.contributors).toEqual([
      { name: 'Alan Turing' },
      { name: 'Grace Hopper' },
      // The tool knew this author only by an address, so the address is not shown.
      { name: 'sam' },
    ])
    // The editor who published, and four more.
    expect(hit?.contributorCount).toBe(5)
  })

  it('never puts an email address in a response', async () => {
    expect((await search('hedgehogs')).body).not.toContain('@')
    expect((await search('database')).body).not.toContain('@')
  })

  it('reads every contributor of a page in one query, not one per hit', async () => {
    const page = vi.spyOn(harness.deps.uow.repos.revisions, 'listContributorsForDocuments')
    const single = vi.spyOn(harness.deps.uow.repos.revisions, 'listContributors')
    try {
      const body = (await search('database')).json() as SearchResponse
      expect(idsOf(body).length).toBeGreaterThan(1)
      expect(page).toHaveBeenCalledTimes(1)
      expect(single).not.toHaveBeenCalled()
    } finally {
      page.mockRestore()
      single.mockRestore()
    }
  })
})

/**
 * `GET /api/search/suggestions`: completing the value of a filter from what
 * the caller may read, as names and never addresses.
 */
describe('suggesting filter values', () => {
  interface Suggestions {
    readonly field: string
    readonly suggestions: readonly { readonly value: string; readonly label: string }[]
  }

  const suggest = (
    field: string,
    prefix: string | null = '',
    cookies: Record<string, string> = editor,
    extra: Record<string, string> = {},
  ) => {
    const parameters = new URLSearchParams({ field, ...extra })
    if (prefix !== null) parameters.set('prefix', prefix)
    return harness.app.inject({
      method: 'GET',
      url: `/api/search/suggestions?${parameters.toString()}`,
      cookies,
    })
  }
  const valuesOf = async (
    field: string,
    prefix: string | null = '',
    cookies: Record<string, string> = editor,
    extra: Record<string, string> = {},
  ) =>
    ((await suggest(field, prefix, cookies, extra)).json() as Suggestions).suggestions.map(
      (item) => item.value,
    )

  beforeAll(async () => {
    const { repos } = harness.deps.uow
    const now = harness.clock.now()

    // A unit and a workspace the editor has no grant on, with a group in it.
    const rival = await repos.units.create({
      id: harness.deps.ids.uuid(),
      parentId: null,
      name: 'Skunkworks',
      slug: 'skunkworks',
      label: 'company',
      now,
    })
    await repos.workspaces.create({
      id: toWorkspaceId(harness.deps.ids.uuid()),
      unitId: rival.id,
      name: 'Hangar',
      slug: 'hangar',
      now,
    })
    await repos.groups.create({
      id: toGroupId(harness.deps.ids.uuid()),
      unitId: rival.id,
      parentGroupId: null,
      name: 'Project X',
      now,
    })
    await repos.groups.create({
      id: toGroupId(harness.deps.ids.uuid()),
      unitId: tenancy.unitId,
      parentGroupId: null,
      name: 'Reliability guild',
      now,
    })

    // A document that carries a tag and the admin's name, which the viewer is denied.
    const secret = await createDocument(
      'Vault procedures',
      tenancy.workspaceId,
      tenancy.collectionId,
    )
    await repos.revisions.append({
      id: 'secret-admin',
      documentId: secret,
      workspaceId: tenancy.workspaceId,
      revision: toRevisionId((0x5ec0de).toString(16).padStart(40, '0')),
      authorName: 'Admin',
      authorEmail: 'Admin@example.com',
      timestamp: new Date(now.getTime() - 60_000),
      summary: 'Admin wrote it first',
      changeNote: null,
      now,
    })
    await publishMarkdown(
      secret,
      ['---', 'tags:', '  - Vaultonly', '---', '', '# Vault procedures', '', 'Vault.'].join('\n'),
    )
    const denied = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.viewer,
      scopeKind: 'document',
      scopeId: secret,
      role: 'viewer',
      effect: 'deny',
      createdBy: tenancy.admin,
    })
    /* v8 ignore next -- the fixture's grant is valid by construction. */
    if (denied.kind !== 'created') throw new Error(`fixture grant rejected: ${denied.kind}`)
  }, 60_000)

  it('answers in the shape the web codes against', async () => {
    const response = await suggest('tag', 'vaultonly')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      field: 'tag',
      suggestions: [{ value: 'vaultonly', label: 'vaultonly' }],
    })
  })

  it('completes the names of people who published something the caller may read', async () => {
    expect(await valuesOf('by', 'edi')).toEqual(['Editor'])
    expect(await valuesOf('by', 'ADM')).toEqual(['Admin'])
  })

  it('does not name somebody the index only knows by an address, nor offer an address', async () => {
    // The tool-written revisions in the group above name people with no account.
    const names = await valuesOf('by', '')
    expect(names).not.toContain('Alan Turing')
    expect(names).not.toContain('sam@example.com')
    expect((await suggest('by', '')).body).not.toContain('@')
  })

  it('never lets a document the caller is denied contribute a name or a tag', async () => {
    expect(await valuesOf('tag', 'vaultonly', viewer)).toEqual([])
    expect(await valuesOf('by', 'admin', viewer)).toEqual([])
    // The same values are there for somebody who may read the document.
    expect(await valuesOf('tag', 'vaultonly', editor)).toEqual(['vaultonly'])
    expect(await valuesOf('by', 'admin', editor)).toEqual(['Admin'])
  })

  it('offers a stranger with no grants nothing at all, for any field but the fixed statuses', async () => {
    for (const field of ['by', 'team', 'tag', 'collection', 'in']) {
      expect(await valuesOf(field, '', outsider)).toEqual([])
    }
  })

  it('completes teams from the units above the caller workspaces and their groups', async () => {
    expect(await valuesOf('team', '')).toEqual(
      expect.arrayContaining(['Acme', 'Reliability guild']),
    )
    expect(await valuesOf('team', 'guild')).toEqual(['Reliability guild'])
  })

  it('does not suggest a team outside the caller unit chain', async () => {
    for (const hidden of ['skunk', 'project x']) {
      expect(await valuesOf('team', hidden)).toEqual([])
    }
    expect(await valuesOf('team', 'skunk', admin)).toEqual(['Skunkworks'])
    expect(await valuesOf('team', 'project', admin)).toEqual(['Project X'])
  })

  it('completes collections and workspaces the caller may read', async () => {
    expect(await valuesOf('collection', 'arch')).toEqual(['Architecture'])
    expect(await valuesOf('collection', 'camp', editor, { workspace: 'marketing' })).toEqual([
      'Campaigns',
    ])
    expect(await valuesOf('in', '')).toEqual(['Engineering', 'Marketing'])
    expect(await valuesOf('in', 'hangar')).toEqual([])
    expect(await valuesOf('in', 'hangar', admin)).toEqual(['Hangar'])
  })

  it('completes the fixed statuses', async () => {
    expect(await valuesOf('status', '')).toEqual(['archived', 'draft', 'published'])
    expect(await valuesOf('status', 'pub')).toEqual(['published'])
  })

  it('treats a missing prefix as an empty one, and honours the limit', async () => {
    expect(await valuesOf('status', null)).toEqual(['archived', 'draft', 'published'])
    expect(await valuesOf('status', '', editor, { limit: '2' })).toEqual(['archived', 'draft'])
  })

  it('refuses a workspace the caller cannot read as one that is not there', async () => {
    expect((await suggest('tag', '', outsider, { workspace: 'marketing' })).statusCode).toBe(404)
    expect((await suggest('tag', '', editor, { workspace: 'marketing' })).statusCode).toBe(200)
  })

  it('validates the query string rather than trusting it', async () => {
    expect((await suggest('nonsense')).statusCode).toBe(400)
    expect((await suggest('tag', '', editor, { limit: '0' })).statusCode).toBe(400)
    expect((await suggest('tag', '', editor, { limit: '11' })).statusCode).toBe(400)
    expect((await suggest('tag', 'x'.repeat(101))).statusCode).toBe(400)
    expect(
      (await harness.app.inject({ method: 'GET', url: '/api/search/suggestions', cookies: editor }))
        .statusCode,
    ).toBe(400)
  })

  it('needs a session', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/search/suggestions?field=tag',
    })
    expect(response.statusCode).toBe(401)
  })

  it('shares a rate limit with search, so a box that asks both draws on one budget', async () => {
    // A person nothing else in this file has used, so their budget is theirs alone.
    const typist = toUserId(harness.deps.ids.uuid())
    await harness.deps.uow.repos.users.create({
      id: typist,
      email: 'typist@example.com',
      displayName: 'Typist',
      now: harness.clock.now(),
    })
    const cookies = await harness.cookiesFor(typist)
    const budget = harness.deps.config.searchRateLimitMax
    for (let at = 0; at < budget - 2; at += 1) {
      await harness.app.inject({ method: 'GET', url: '/api/search?q=database', cookies })
    }
    const statuses: number[] = []
    for (let at = 0; at < 6; at += 1) {
      statuses.push((await suggest('status', '', cookies)).statusCode)
    }
    expect(statuses).toContain(429)
    expect(statuses[0]).toBe(200)
  })
})

/** A document about zebras, with the front matter lines it is given. */
const zebra = (frontMatter: readonly string[], heading: string) =>
  ['---', ...frontMatter, '---', '', `# ${heading}`, '', 'A zebra crossing is painted here.'].join(
    '\n',
  )

/**
 * Tags as a hierarchy, `prop:` over front matter that is not a core field, and
 * facets: the counts of what a query matched, from what the caller may read.
 */
describe('tags, properties and facets', () => {
  interface Facet {
    readonly value: string
    readonly label: string
    readonly count: number
  }
  interface FacetedResponse extends SearchResponse {
    readonly facets?: {
      readonly tag?: readonly Facet[]
      readonly status?: readonly Facet[]
      readonly collection?: readonly Facet[]
    }
  }

  let retries: DocumentId
  let invoices: DocumentId
  let support: DocumentId
  let audit: DocumentId

  beforeAll(async () => {
    // Every search here draws on the editor's budget, which the describes above have spent.
    harness.clock.advance(2 * 60 * 1000)
    retries = await publishDocument(
      'Zebra billing retries',
      zebra(
        [
          'tags:',
          '  - Area/Billing',
          '  - runbook',
          'severity: High',
          'regions:',
          '  - EU',
          '  - US',
        ],
        'Zebra billing retries',
      ),
    )
    invoices = await publishDocument(
      'Zebra invoices',
      zebra(
        ['status: draft', 'tags:', '  - area/billing/invoices', 'severity: low'],
        'Zebra invoices',
      ),
    )
    support = await publishDocument(
      'Zebra support',
      zebra(['tags:', '  - area/support', 'severity: High'], 'Zebra support'),
      marketing,
      campaigns,
    )
    audit = await publishDocument(
      'Zebra audit',
      zebra(['tags:', '  - area/billing/audit', 'severity: high'], 'Zebra audit'),
    )
    const denied = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.viewer,
      scopeKind: 'document',
      scopeId: audit,
      role: 'viewer',
      effect: 'deny',
      createdBy: tenancy.admin,
    })
    /* v8 ignore next -- the fixture's grants are valid by construction. */
    if (denied.kind !== 'created') throw new Error(`fixture grant rejected: ${denied.kind}`)
  }, 60_000)

  const asked = async (query: string, cookies = editor) =>
    idsOf((await search(query, cookies)).json() as SearchResponse).toSorted()
  const faceted = async (
    query: string,
    facets: string,
    cookies = editor,
    extra: Record<string, string> = {},
  ) => (await search(query, cookies, { facets, ...extra })).json() as FacetedResponse

  it('finds a parent tag in everything beneath it, and a child tag only in its own subtree', async () => {
    expect(await asked('zebra tag:area')).toEqual([retries, invoices, support, audit].toSorted())
    expect(await asked('zebra tag:Area/Billing')).toEqual([retries, invoices, audit].toSorted())
    expect(await asked('zebra tag:area/billing/invoices')).toEqual([invoices])
    expect(await asked('zebra tag:area/bill')).toEqual([])
  })

  it('finds what holds a front-matter property that is not a core field', async () => {
    expect(await asked('zebra prop:severity=high')).toEqual([retries, support, audit].toSorted())
    expect(await asked('zebra prop:regions=us')).toEqual([retries])
    expect(await asked('zebra -prop:severity=high')).toEqual([invoices])
  })

  it('never offers a core field as a property, and a filter that is not key=value finds nothing', async () => {
    for (const query of [
      'zebra prop:tags=runbook',
      'zebra prop:status=draft',
      'zebra prop:severity',
      'zebra prop:=high',
    ]) {
      expect({ query, found: await asked(query) }).toEqual({ query, found: [] })
    }
  })

  it('keeps a property findable after the index is rebuilt from the content store', async () => {
    await reindex(harness.deps)
    expect(await asked('zebra prop:severity=high')).toEqual([retries, support, audit].toSorted())
    expect(await asked('zebra tag:area/billing')).toEqual([retries, invoices, audit].toSorted())
  })

  it('does not find a denied document by a property or a tag', async () => {
    expect(await asked('zebra prop:severity=high', viewer)).toEqual([retries, support].toSorted())
    expect(await asked('zebra tag:area/billing/audit', viewer)).toEqual([])
  })

  it('has no facets unless they are asked for, and asks the engine for none', async () => {
    const counted = vi.spyOn(harness.deps.search, 'facets')
    try {
      const body = (await search('zebra')).json() as FacetedResponse
      expect(body).not.toHaveProperty('facets')
      expect(counted).not.toHaveBeenCalled()
    } finally {
      counted.mockRestore()
    }
  })

  it.each([
    ['in a workspace', true],
    ['with no workspace preferred', false],
  ])(
    'asks the engine for the page and the counts with one shared visibility, %s',
    async (_name, inWorkspace) => {
      const paged = vi.spyOn(harness.deps.search, 'search')
      const counted = vi.spyOn(harness.deps.search, 'facets')
      try {
        await faceted('zebra', 'tag', editor, inWorkspace ? { workspace: tenancy.workspaceId } : {})
        const page = paged.mock.calls[0]?.[0]
        const counts = counted.mock.calls[0]?.[0]
        expect(page?.visibility).toBeDefined()
        expect(counts?.visibility).toBe(page?.visibility)
        expect(page?.visibility?.filter).toBe(page?.filter)
        expect(counts?.visibility?.filter).toBe(counts?.filter)
        expect(counts?.currentWorkspaceId).toBe(page?.currentWorkspaceId)
      } finally {
        paged.mockRestore()
        counted.mockRestore()
      }
    },
  )

  it('counts tags (with every ancestor), statuses and collections over everything matched', async () => {
    const body = await faceted('zebra', 'tag,status,collection')
    expect(body.facets).toEqual({
      tag: [
        { value: 'area', label: 'area', count: 4 },
        { value: 'area/billing', label: 'area/billing', count: 3 },
        { value: 'area/billing/audit', label: 'area/billing/audit', count: 1 },
        { value: 'area/billing/invoices', label: 'area/billing/invoices', count: 1 },
        { value: 'area/support', label: 'area/support', count: 1 },
        { value: 'runbook', label: 'runbook', count: 1 },
      ],
      status: [
        { value: 'published', label: 'published', count: 3 },
        { value: 'draft', label: 'draft', count: 1 },
      ],
      collection: [
        { value: 'Architecture', label: 'Architecture', count: 3 },
        { value: 'Campaigns', label: 'Campaigns', count: 1 },
      ],
    })
  })

  it('counts only the facets named, in a response that is otherwise the same', async () => {
    const plain = (await search('zebra')).json() as FacetedResponse
    const body = await faceted('zebra', 'status,status')
    expect(Object.keys(body.facets ?? {})).toEqual(['status'])
    expect(idsOf(body)).toEqual(idsOf(plain))
  })

  it('counts the query as asked, filters included', async () => {
    const body = await faceted('zebra tag:area/billing', 'tag,status')
    expect(body.facets?.tag).toContainEqual({
      value: 'area/billing',
      label: 'area/billing',
      count: 3,
    })
    expect(body.facets?.status).toEqual([
      { value: 'published', label: 'published', count: 2 },
      { value: 'draft', label: 'draft', count: 1 },
    ])
  })

  it('counts over the whole matching set, not the page that was returned', async () => {
    const body = await faceted('zebra', 'status', editor, { limit: '1' })
    expect(idsOf(body)).toHaveLength(1)
    expect(body.facets?.status?.reduce((sum, { count }) => sum + count, 0)).toBe(4)
  })

  it('equals the number of results that paging to the end finds', async () => {
    const body = await faceted('zebra', 'tag,status,collection')
    const everyHit = async (query: string) => {
      const found: string[] = []
      let cursor: string | undefined
      do {
        const page = (
          await search(query, editor, { limit: '1', ...(cursor === undefined ? {} : { cursor }) })
        ).json() as SearchResponse
        found.push(...idsOf(page))
        cursor = page.nextCursor
      } while (cursor !== undefined)
      return found
    }
    for (const [facet, key] of [
      ['tag', 'tag'],
      ['status', 'status'],
      ['collection', 'collection'],
    ] as const) {
      for (const { value, count } of body.facets?.[facet] ?? []) {
        expect(await everyHit(`zebra ${key}:${value}`), `${key}:${value}`).toHaveLength(count)
      }
    }
  })

  it('never counts a document the person asking is denied', async () => {
    const body = await faceted('zebra', 'tag,status,collection', viewer)
    const tags = body.facets?.tag ?? []
    expect(tags).toContainEqual({ value: 'area', label: 'area', count: 3 })
    expect(tags).toContainEqual({ value: 'area/billing', label: 'area/billing', count: 2 })
    expect(tags.map(({ value }) => value)).not.toContain('area/billing/audit')
    expect(body.facets?.collection).toContainEqual({
      value: 'Architecture',
      label: 'Architecture',
      count: 2,
    })
  })

  it('gives somebody with no grant empty facets', async () => {
    const body = await faceted('zebra', 'tag,status,collection', outsider)
    expect(body.facets).toEqual({ tag: [], status: [], collection: [] })
  })

  it('names the collections with one lookup, however many values there are', async () => {
    const lookup = vi.spyOn(harness.deps.uow.repos.collections, 'listByIds')
    try {
      await faceted('zebra', 'collection')
      expect(lookup).toHaveBeenCalledTimes(1)
      lookup.mockClear()
      await faceted('zebra', 'tag,status')
      expect(lookup).not.toHaveBeenCalled()
    } finally {
      lookup.mockRestore()
    }
  })

  it('refuses a facet it does not know, or a list that is not a list', async () => {
    for (const facets of ['labels', 'tag,labels', 'tag,', ',tag', '', 'Tag', 'tag status']) {
      expect({ facets, status: (await search('zebra', editor, { facets })).statusCode }).toEqual({
        facets,
        status: 400,
      })
    }
  })
})
