import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DocumentId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The two reads the public menu editor makes, through HTTP: who may make
 * them, and what they say about targets that are private, public and gone.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let draft: DocumentId

const DELETED = '00000000-0000-4000-8000-0000000002ff'

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  const created = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: { collectionId: tenancy.collectionId, title: 'Runbook' },
  })
  if (created.statusCode !== 201) throw new Error(`creating the fixture failed: ${created.body}`)
  draft = created.json().document.id as DocumentId
}, 30_000)

afterAll(async () => {
  await harness.close()
})

const targets = (query: string, cookies = admin) =>
  harness.app.inject({
    method: 'GET',
    url: `/api/settings/organisation/public-menu/targets?${query}`,
    cookies,
  })

describe('GET /settings/organisation/public-menu/targets', () => {
  it('describes each target: its title, where it sits, and that it is not public yet', async () => {
    const response = await targets(
      `document=${draft}&document=${DELETED}&collection=${tenancy.collectionId}`,
    )
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      targets: [
        {
          kind: 'document',
          id: draft,
          status: 'not-public',
          title: 'Runbook',
          workspaceName: expect.any(String),
          collectionName: expect.any(String),
          href: null,
        },
        {
          kind: 'document',
          id: DELETED,
          status: 'missing',
          title: null,
          workspaceName: null,
          collectionName: null,
          href: null,
        },
        expect.objectContaining({
          kind: 'collection',
          id: tenancy.collectionId,
          status: 'not-public',
        }),
      ],
    })
  })

  it('accepts a single id, and no ids at all', async () => {
    expect((await targets(`document=${draft}`)).json().targets).toHaveLength(1)
    expect((await targets('')).json()).toEqual({ targets: [] })
  })

  it('is instance administration', async () => {
    expect((await targets(`document=${draft}`, editor)).statusCode).toBe(403)
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: `/api/settings/organisation/public-menu/targets?document=${draft}`,
        })
      ).statusCode,
    ).toBe(401)
  })

  it('refuses more ids than a menu could hold', async () => {
    const many = Array.from({ length: 101 }, () => `document=${DELETED}`).join('&')
    expect((await targets(many)).statusCode).toBe(400)
  })
})

describe('GET /settings/organisation/public-menu/collections', () => {
  const collections = (query: string, cookies = admin) =>
    harness.app.inject({
      method: 'GET',
      url: `/api/settings/organisation/public-menu/collections?${query}`,
      cookies,
    })

  it('finds collections in any workspace by a fragment of the name', async () => {
    const all = await collections('q=a&limit=20')
    expect(all.statusCode).toBe(200)
    const found = all.json().collections as { id: string; isPublic: boolean }[]
    expect(found.map((row) => row.id)).toContain(tenancy.collectionId)
    expect(found.find((row) => row.id === tenancy.collectionId)?.isPublic).toBe(false)
  })

  it('offers eight candidates unless asked for more', async () => {
    const created = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((shelf) =>
        harness.app.inject({
          method: 'POST',
          url: `/api/workspaces/${tenancy.workspaceId}/collections`,
          cookies: admin,
          payload: { name: `Shelf ${shelf.toString()}` },
        }),
      ),
    )
    expect(created.map((response) => response.statusCode)).toEqual(Array(9).fill(201))
    expect((await collections('q=shelf')).json().collections).toHaveLength(8)
    expect((await collections('q=shelf&limit=20')).json().collections).toHaveLength(9)
  })

  it('needs something to look for, and is instance administration', async () => {
    expect((await collections('q=')).statusCode).toBe(400)
    expect((await collections('q=a', editor)).statusCode).toBe(403)
  })
})
