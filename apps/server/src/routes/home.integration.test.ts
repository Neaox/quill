import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGrant } from '@quill/application'
import type { DocumentId, WorkspaceId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The home page's summary: what each kind of reader is told, that it needs a
 * session, and how it is personal to the person asking (ADR-053).
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>

async function createDocument(cookies: Record<string, string>, title: string): Promise<DocumentId> {
  const created = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies,
    payload: { collectionId: tenancy.collectionId, title },
  })
  expect(created.statusCode).toBe(201)
  return created.json().document.id as DocumentId
}

async function publish(cookies: Record<string, string>, id: DocumentId): Promise<void> {
  const draft = await harness.deps.uow.repos.drafts.find(id)
  const published = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/publish`,
    cookies,
    payload: { base: draft?.baseRevision ?? null },
  })
  expect(published.statusCode).toBe(200)
}

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)

  await createDocument(admin, 'Unfinished idea')
}, 30_000)

afterAll(async () => {
  await harness.close()
})

const home = (cookies: Record<string, string>, query = '') =>
  harness.app.inject({ method: 'GET', url: `/api/home${query}`, cookies })

describe('GET /api/home', () => {
  it('needs a session', async () => {
    expect((await harness.app.inject({ method: 'GET', url: '/api/home' })).statusCode).toBe(401)
  })

  it('counts the workspace and names the admin’s own draft', async () => {
    const response = await home(admin)

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.stats).toEqual([
      expect.objectContaining({
        workspaceId: tenancy.workspaceId,
        documentCount: 1,
        draftCount: 1,
      }),
    ])
    expect(body.drafts.total).toBe(1)
    expect(body.drafts.items).toEqual([
      expect.objectContaining({ title: 'Unfinished idea', workspaceId: tenancy.workspaceId }),
    ])
    expect(body.recent).toEqual([])
    expect(body.anyPublished).toBe(false)
  })

  it('counts a viewer’s workspace but lists none of the drafts, which are not theirs', async () => {
    const body = (await home(viewer)).json()

    expect(body.stats.map((row: { workspaceId: string }) => row.workspaceId)).toEqual([
      tenancy.workspaceId,
    ])
    expect(body.stats[0].draftCount).toBe(1)
    expect(body.drafts).toEqual({ total: 0, items: [] })
  })

  it('says nothing at all to somebody with no access', async () => {
    expect((await home(outsider)).json()).toEqual({
      stats: [],
      drafts: { total: 0, items: [] },
      recent: [],
      jumpBackIn: [],
      scope: 'everywhere',
      hasHistory: false,
      anyPublished: false,
    })
  })

  it('refuses a scope it does not know', async () => {
    expect((await home(admin, '?scope=nowhere')).statusCode).toBe(400)
  })
})

describe('GET /api/home: what is relevant to the person', () => {
  let published: DocumentId

  beforeAll(async () => {
    published = await createDocument(editor, 'Published by the editor')
    await publish(editor, published)
  }, 30_000)

  it('shows a newcomer everywhere, naming who made each change', async () => {
    const body = (await home(viewer)).json()

    expect(body).toMatchObject({ scope: 'everywhere', hasHistory: false, anyPublished: true })
    expect(body.recent).toEqual([
      expect.objectContaining({
        id: published,
        updatedBy: { id: tenancy.editor, name: 'Editor' },
      }),
    ])
    expect(body.stats[0].engagement).toBe(0)
  })

  it('leaves out the caller’s own edits once they have history, and puts them first when asked for everywhere', async () => {
    const mine = (await home(editor)).json()
    expect(mine).toMatchObject({ scope: 'mine', hasHistory: true })
    expect(mine.recent).toEqual([])
    expect(mine.stats[0].engagement).toBe(1)
    // The editor created the page they published; it is not a draft any more.
    expect(mine.drafts.items).toEqual([])

    const everywhere = (await home(editor, '?scope=everywhere')).json()
    expect(everywhere.scope).toBe('everywhere')
    expect(everywhere.recent.map((row: { id: string }) => row.id)).toEqual([published])
  })

  it('shows somebody else’s change to a person who works in the workspace', async () => {
    const viewed = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${published}/view`,
      cookies: viewer,
    })
    expect(viewed.statusCode).toBe(204)

    const body = (await home(viewer)).json()
    expect(body).toMatchObject({ scope: 'mine', hasHistory: true })
    expect(body.recent.map((row: { id: string }) => row.id)).toEqual([published])
    expect(body.stats[0].engagement).toBe(1)
    expect(body.jumpBackIn).toEqual([
      expect.objectContaining({
        id: published,
        title: 'Published by the editor',
        workspaceId: tenancy.workspaceId,
        viewedAt: harness.clock.now().toISOString(),
      }),
    ])
  })

  it('does not offer a jump back in to a document the person can no longer open', async () => {
    await harness.deps.uow.repos.documentViews.touch({
      userId: tenancy.outsider,
      documentId: published,
      workspaceId: tenancy.workspaceId,
      now: harness.clock.now(),
      debounceBefore: new Date(0),
    })

    const body = (await home(outsider)).json()
    expect(body.jumpBackIn).toEqual([])
    expect(body.stats).toEqual([])
  })
})

describe('GET /api/home: a workspace with nothing in it', () => {
  it('is counted, with no time of last change', async () => {
    const empty = await harness.deps.uow.repos.workspaces.create({
      id: harness.deps.ids.uuid() as WorkspaceId,
      unitId: tenancy.unitId,
      name: 'Empty',
      slug: 'empty',
      now: harness.clock.now(),
    })
    const granted = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.outsider,
      scopeKind: 'workspace',
      scopeId: empty.id,
      role: 'viewer',
      effect: 'allow',
      createdBy: tenancy.admin,
    })
    expect(granted.kind).toBe('created')

    const body = (await home(outsider)).json()

    expect(body.stats).toEqual([
      expect.objectContaining({
        workspaceId: empty.id,
        documentCount: 0,
        draftCount: 0,
        updatedAt: null,
      }),
    ])
  })
})
