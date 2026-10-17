import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DocumentId, UserId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * What a person has opened (ADR-053): recorded on opening, debounced, private
 * to the person, clearable by them, and swept after ninety days.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>
let document: DocumentId

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
    payload: { collectionId: tenancy.collectionId, title: 'Opened a lot' },
  })
  document = created.json().document.id as DocumentId
}, 30_000)

afterAll(async () => {
  await harness.close()
})

const view = (cookies?: Record<string, string>, id: string = document) =>
  harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/view`,
    ...(cookies === undefined ? {} : { cookies }),
  })

const recent = (user: UserId) =>
  harness.deps.uow.repos.documentViews.listRecent({
    userId: user,
    since: new Date(0),
    limit: 10,
  })

describe('POST /api/documents/:id/view', () => {
  it('needs a session', async () => {
    expect((await view()).statusCode).toBe(401)
  })

  it('is refused to somebody who cannot view the document, and records nothing', async () => {
    expect((await view(outsider)).statusCode).toBe(403)
    expect(await recent(tenancy.outsider)).toEqual([])
  })

  it('records the open, and does nothing for another inside five minutes', async () => {
    expect((await view(viewer)).statusCode).toBe(204)
    const first = await recent(tenancy.viewer)
    expect(first).toMatchObject([
      { documentId: document, workspaceId: tenancy.workspaceId, views: 1 },
    ])

    harness.clock.advance(4 * 60_000)
    expect((await view(viewer)).statusCode).toBe(204)
    expect(await recent(tenancy.viewer)).toEqual(first)

    harness.clock.advance(2 * 60_000)
    expect((await view(viewer)).statusCode).toBe(204)
    expect(await recent(tenancy.viewer)).toMatchObject([{ views: 2 }])
  })

  it('answers the same way for an unknown document as for one the caller may not see', async () => {
    expect((await view(viewer, '00000000-0000-4000-8000-0000000000ff')).statusCode).toBe(404)
  })

  it('is not audited', async () => {
    const audits = await harness.database.pool.query(
      "SELECT 1 FROM audit_events WHERE type ILIKE '%view%' OR type ILIKE '%history%'",
    )
    expect(audits.rowCount).toBe(0)
  })
})

describe('DELETE /api/me/history', () => {
  it('needs a session', async () => {
    expect(
      (await harness.app.inject({ method: 'DELETE', url: '/api/me/history' })).statusCode,
    ).toBe(401)
  })

  it('forgets the caller’s views and nobody else’s', async () => {
    await view(editor)
    expect(await recent(tenancy.viewer)).not.toEqual([])

    const cleared = await harness.app.inject({
      method: 'DELETE',
      url: '/api/me/history',
      cookies: viewer,
    })

    expect(cleared.statusCode).toBe(204)
    expect(await recent(tenancy.viewer)).toEqual([])
    expect(await recent(tenancy.editor)).not.toEqual([])
  })
})

describe('the ninety-day sweep', () => {
  it('forgets views older than ninety days when the job runner’s housekeeping runs', async () => {
    await view(viewer)
    harness.clock.advance(91 * 24 * 60 * 60 * 1000)
    // Sessions last a year in the harness, so the people are still signed in.

    expect(await harness.jobRunner.runDueJobs()).toContain('sweep-expired')

    expect(await recent(tenancy.viewer)).toEqual([])
    expect(await recent(tenancy.editor)).toEqual([])
  })
})
