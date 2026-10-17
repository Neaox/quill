import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DocumentId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The people directory behind the properties line's owner picker
 * (`docs/design/properties.md`): who an editor of a document can name as its
 * owner, and the names behind the addresses a document already holds.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>
let documentId: DocumentId

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)
  const created = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: { collectionId: tenancy.collectionId, title: 'Runbook' },
  })
  documentId = created.json().document.id as DocumentId
}, 30_000)

afterAll(async () => {
  await harness.close()
})

function people(query: string, cookies: Record<string, string>) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/documents/${documentId}/people?${query}`,
    cookies,
  })
}

describe('GET /api/documents/:id/people', () => {
  it('finds people by name or address for someone who can edit the document', async () => {
    const response = await people('q=edit', editor)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      people: [{ value: 'editor@example.com', name: 'Editor', detail: 'editor@example.com' }],
    })
  })

  it('names the addresses a document holds, one or many, in one request', async () => {
    const one = await people('email=VIEWER%40example.com', editor)
    expect(one.json().people).toEqual([
      { value: 'VIEWER@example.com', name: 'Viewer', detail: 'viewer@example.com' },
    ])
    const many = await people(
      'email=viewer%40example.com&email=team%40example.com&email=admin%40example.com',
      editor,
    )
    expect(many.json().people.map((person: { name: string }) => person.name)).toEqual([
      'Viewer',
      'Admin',
    ])
  })

  it('answers nothing to an empty question', async () => {
    expect((await people('', editor)).json()).toEqual({ people: [] })
  })

  it('is closed to anyone who cannot edit the document, so the directory is not a lookup service', async () => {
    expect((await people('q=edit', viewer)).statusCode).toBe(403)
    expect((await people('q=edit', outsider)).statusCode).toBe(403)
    const anonymous = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${documentId}/people?q=edit`,
    })
    expect(anonymous.statusCode).toBe(401)
  })

  it('refuses a question too long to be a name', async () => {
    expect((await people(`q=${'a'.repeat(201)}`, editor)).statusCode).toBe(400)
  })
})
