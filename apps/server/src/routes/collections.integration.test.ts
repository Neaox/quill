import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  defaultOrganisationSettings,
  ORGANISATION_SETTINGS_PATH,
  SETTINGS_VERSION,
  SYSTEM_WORKSPACE_ID,
} from '@quill/application'
import type { OrganisationSettings } from '@quill/application'
import type { CollectionId, DocumentId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Collections through HTTP: who may create, rename and delete one, the two
 * refusals a client has to branch on — a name whose slug is taken, and a
 * collection that still holds documents — and publishing one to the web
 * (ADR-023), which is the only part of the public site that is JSON.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

/** A step that must have worked, stated where a helper can say so. */
function succeeded(response: { statusCode: number }, status = 200): void {
  expect(response.statusCode).toBe(status)
}

async function create(name: string, cookies = admin) {
  return harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/collections`,
    cookies,
    payload: { name },
  })
}

async function list(cookies: Record<string, string>) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${tenancy.workspaceId}/collections`,
    cookies,
  })
}

describe('creating a collection', () => {
  it('derives the slug, answers 201, and lists it afterwards', async () => {
    const response = await create('Operations runbooks')
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      workspaceId: tenancy.workspaceId,
      name: 'Operations runbooks',
      slug: 'operations-runbooks',
    })

    const listed = await list(viewer)
    expect(listed.statusCode).toBe(200)
    expect((listed.json() as { slug: string }[]).map((row) => row.slug)).toContain(
      'operations-runbooks',
    )
  })

  it('answers 409 when the slug is already taken', async () => {
    await create('Duplicate collection')
    const again = await create('duplicate collection')
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('collection_slug_taken')
  })

  it('needs manage on the workspace', async () => {
    // The fixture's editor holds `editor` at the workspace, which is not
    // enough to reshape the workspace's containers.
    expect((await create('From an editor', editor)).statusCode).toBe(403)
    expect((await create('From a viewer', viewer)).statusCode).toBe(403)
  })
})

describe('renaming a collection', () => {
  it('changes the name and keeps the slug', async () => {
    const created = await create('Before')
    const id = created.json().id as CollectionId

    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/collections/${id}`,
      cookies: admin,
      payload: { name: 'After' },
    })
    expect(renamed.statusCode).toBe(200)
    // Nothing addresses a collection by its slug, so a rename moves nothing.
    expect(renamed.json()).toMatchObject({ name: 'After', slug: 'before' })
  })

  it('refuses a caller who may not manage it, and hides one they cannot see', async () => {
    const created = await create('Managed only')
    const id = created.json().id as CollectionId

    expect(
      (
        await harness.app.inject({
          method: 'PATCH',
          url: `/api/collections/${id}`,
          cookies: editor,
          payload: { name: 'Nope' },
        })
      ).statusCode,
    ).toBe(403)

    // Somebody with no grant at all is told it does not exist, not that they
    // may not touch it.
    expect(
      (
        await harness.app.inject({
          method: 'PATCH',
          url: `/api/collections/${id}`,
          cookies: outsider,
          payload: { name: 'Nope' },
        })
      ).statusCode,
    ).toBe(403)
  })
})

describe('deleting a collection', () => {
  it('deletes an empty one', async () => {
    const created = await create('Empty and doomed')
    const id = created.json().id as CollectionId

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/collections/${id}`,
      cookies: admin,
    })
    expect(deleted.statusCode).toBe(204)
    expect((await list(admin)).json().map((row: { id: string }) => row.id)).not.toContain(id)
  })

  /**
   * `collection_id` is nullable, so deleting the row would set it null on
   * every document it held — and a document in no collection has no scope
   * chain at all (ADR-012). The client moves them first.
   */
  it('answers 409 collection_not_empty while it still holds documents', async () => {
    const created = await create('Holds a document')
    const id = created.json().id as CollectionId

    const document = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: editor,
      payload: { collectionId: id, title: 'A note' },
    })
    expect(document.statusCode).toBe(201)

    const refused = await harness.app.inject({
      method: 'DELETE',
      url: `/api/collections/${id}`,
      cookies: admin,
    })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toMatchObject({
      code: 'collection_not_empty',
      details: { documents: 1 },
    })
  })

  it('refuses a caller who may not manage it', async () => {
    const created = await create('Not yours to delete')
    const id = created.json().id as CollectionId
    expect(
      (
        await harness.app.inject({
          method: 'DELETE',
          url: `/api/collections/${id}`,
          cookies: editor,
        })
      ).statusCode,
    ).toBe(403)
  })
})

describe('listing collections', () => {
  it('needs a session, and view on the workspace', async () => {
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: `/api/workspaces/${tenancy.workspaceId}/collections`,
        })
      ).statusCode,
    ).toBe(401)
    expect((await list(outsider)).statusCode).toBe(403)
  })
})

describe('publishing a collection to the web', () => {
  /** Puts the organisation's policy where a test needs it, through the API. */
  async function allowPublishing(allowed: boolean): Promise<void> {
    const current = await harness.app.inject({
      method: 'GET',
      url: '/api/settings/organisation',
      cookies: admin,
    })
    const body = current.json() as { settings: OrganisationSettings; revision: string | null }
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/api/settings/organisation',
      cookies: admin,
      payload: {
        settings: {
          ...body.settings,
          policies: { ...defaultOrganisationSettings().policies, publicPublishingAllowed: allowed },
        },
        expectedRevision: body.revision,
      },
    })
    expect(response.statusCode).toBe(200)
  }

  const publish = (id: CollectionId, payload: Record<string, unknown>, cookies = admin) =>
    harness.app.inject({
      method: 'POST',
      url: `/api/collections/${id}/public`,
      cookies,
      payload,
    })

  const unpublish = (id: CollectionId, cookies = admin) =>
    harness.app.inject({ method: 'DELETE', url: `/api/collections/${id}/public`, cookies })

  async function newCollection(name: string): Promise<CollectionId> {
    const created = await create(name)
    expect(created.statusCode).toBe(201)
    return created.json().id as CollectionId
  }

  it('publishes, answers with the address, and unpublishes keeping it', async () => {
    await allowPublishing(true)
    const id = await newCollection('Developer docs')

    const published = await publish(id, { siteSlug: 'Developer Docs' })
    expect(published.statusCode).toBe(200)
    expect(published.json()).toMatchObject({
      public: {
        enabled: true,
        siteSlug: 'developer-docs',
        homeDocumentId: null,
        url: `${harness.deps.config.appUrl}/s/developer-docs`,
      },
    })

    const listed = await list(viewer)
    expect(listed.json().find((row: { id: string }) => row.id === id)).toMatchObject({
      public: { enabled: true },
    })

    const taken = await unpublish(id)
    expect(taken.statusCode).toBe(200)
    expect(taken.json()).toMatchObject({ public: { enabled: false, siteSlug: 'developer-docs' } })
  })

  it('lists a collection that was never published with no site at all', async () => {
    const id = await newCollection('Never published')
    const listed = await list(viewer)
    expect(listed.json().find((row: { id: string }) => row.id === id)).toMatchObject({
      public: null,
    })
  })

  it('refuses a caller who may not manage the collection', async () => {
    await allowPublishing(true)
    const id = await newCollection('Not yours to publish')
    expect((await publish(id, {}, editor)).statusCode).toBe(403)
    expect((await unpublish(id, editor)).statusCode).toBe(403)
  })

  it('needs a session', async () => {
    const id = await newCollection('Needs a session')
    expect(
      (
        await harness.app.inject({
          method: 'POST',
          url: `/api/collections/${id}/public`,
          payload: {},
        })
      ).statusCode,
    ).toBe(401)
  })

  it('answers 403 public_publishing_disabled when the organisation forbids it', async () => {
    await allowPublishing(false)
    const id = await newCollection('Forbidden by policy')
    const refused = await publish(id, {})
    expect(refused.statusCode).toBe(403)
    expect(refused.json().error).toMatchObject({ code: 'public_publishing_disabled' })
    await allowPublishing(true)
  })

  it('answers 409 when another collection already answers at that address', async () => {
    await allowPublishing(true)
    const first = await newCollection('First site')
    expect((await publish(first, { siteSlug: 'contested' })).statusCode).toBe(200)

    const second = await newCollection('Second site')
    const refused = await publish(second, { siteSlug: 'contested' })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toMatchObject({
      code: 'public_site_slug_taken',
      details: { siteSlug: 'contested' },
    })
  })

  it('answers 422 for a home document that is not in the collection', async () => {
    await allowPublishing(true)
    const id = await newCollection('Wrong home')
    const document = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: editor,
      payload: { collectionId: tenancy.collectionId, title: 'Elsewhere' },
    })
    expect(document.statusCode).toBe(201)

    const refused = await publish(id, {
      homeDocumentId: document.json().document.id as DocumentId,
    })
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'public_home_not_in_collection' })
  })

  /**
   * A downgrade leaves a settings file this release cannot read. No policy can
   * be applied without it, so publishing is refused and reported rather than
   * being allowed by default (ADR-034).
   */
  it('answers 409 settings_unreadable while the organisation settings cannot be read', async () => {
    const id = await newCollection('Published under a future release')
    const before = await harness.deps.contentStore.readFile(
      SYSTEM_WORKSPACE_ID,
      ORGANISATION_SETTINGS_PATH,
    )
    await harness.deps.contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path: ORGANISATION_SETTINGS_PATH,
      text: `version: ${SETTINGS_VERSION + 1}\nname: From the future\n`,
      expected: before?.text ?? null,
      author: { name: 'A newer release', email: 'future@example.com' },
    })

    const refused = await publish(id, {})
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toMatchObject({ code: 'settings_unreadable' })

    const planted = await harness.deps.contentStore.readFile(
      SYSTEM_WORKSPACE_ID,
      ORGANISATION_SETTINGS_PATH,
    )
    await harness.deps.contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path: ORGANISATION_SETTINGS_PATH,
      text: before?.text ?? '',
      expected: planted?.text ?? null,
      author: { name: 'Restored', email: 'restore@example.com' },
    })
  })

  it('takes the old address’s redirects with it when the address changes', async () => {
    await allowPublishing(true)
    const id = await newCollection('Moved address')
    succeeded(await publish(id, { siteSlug: 'before-the-move' }))

    // A real document, because the row is keyed to one by a foreign key.
    const document = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: editor,
      payload: { collectionId: id, title: 'A page' },
    })
    succeeded(document, 201)
    await harness.deps.uow.repos.publicRedirects.record({
      id: 'old-address',
      siteSlug: 'before-the-move',
      path: 'moved-address/a-page',
      documentId: document.json().document.id as DocumentId,
      now: harness.clock.now(),
    })

    succeeded(await publish(id, { siteSlug: 'after-the-move' }))
    expect(
      await harness.deps.uow.repos.publicRedirects.find('before-the-move', 'moved-address/a-page'),
    ).toBeNull()
  })

  it('answers 422 for a home document that has never been published', async () => {
    await allowPublishing(true)
    const id = await newCollection('Unpublished home')
    const document = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: editor,
      payload: { collectionId: id, title: 'Half written' },
    })
    succeeded(document, 201)

    const refused = await publish(id, { homeDocumentId: document.json().document.id as DocumentId })
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'public_home_not_published' })
  })

  it('answers 409 when a collection that was never published is taken down', async () => {
    const id = await newCollection('Nothing to take down')
    const refused = await unpublish(id)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toMatchObject({ code: 'public_site_not_published' })
  })
})
