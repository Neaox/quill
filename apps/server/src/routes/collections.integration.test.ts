import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CollectionId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Collections through HTTP: who may create, rename and delete one, and the
 * two refusals a client has to branch on — a name whose slug is taken, and a
 * collection that still holds documents.
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
