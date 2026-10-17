import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  defaultOrganisationSettings,
  documentReference,
  ORGANISATION_SETTINGS_PATH,
  SETTINGS_VERSION,
  SYSTEM_WORKSPACE_ID,
} from '@quill/application'
import { parseDocument } from '@quill/markdown'
import type { DocumentId, ShortId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The reader preview end to end (`GET /preview/d/:documentRef`): any document
 * a member may read, rendered through the public site's own templates and
 * chrome, whether or not anything is published to the web — and never to
 * anybody who may not read it, never indexed and never cached publicly.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>

let overview: DocumentId
let overviewRef: string
let unpublished: DocumentId

const OVERVIEW_MARKDOWN = [
  '# Overview',
  '',
  'Acme is an API for moving widgets between warehouses.',
  '',
  '## Getting started',
  '',
  'Create a key.',
  '',
  '## Calling the API',
  '',
  'Send a request.',
  '',
  '## Limits',
  '',
  'One hundred a minute.',
].join('\n')

async function createDocument(title: string): Promise<{ id: DocumentId; shortId: ShortId }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: { collectionId: tenancy.collectionId, title },
  })
  expect(response.statusCode).toBe(201)
  const document = response.json().document as { id: DocumentId; shortId: ShortId }
  return document
}

async function writeAndPublish(id: DocumentId, markdown: string): Promise<void> {
  await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/lock/acquire`,
    cookies: editor,
  })
  const { frontMatter, ast } = parseDocument(markdown)
  const write = await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    cookies: editor,
    payload: { ast: { version: 1, frontMatter, ast }, expectedVersion: 0 },
  })
  expect(write.statusCode).toBe(200)
  await harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/lock`, cookies: editor })
  const published = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/publish`,
    cookies: editor,
    payload: { base: null },
  })
  expect(published.statusCode).toBe(200)
}

const preview = (reference: string, cookies?: Record<string, string>) =>
  harness.app.inject({
    method: 'GET',
    url: `/preview/d/${reference}`,
    ...(cookies === undefined ? {} : { cookies }),
  })

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)

  const created = await createDocument('Overview')
  overview = created.id
  overviewRef = documentReference({ title: 'Overview', shortId: created.shortId })
  await writeAndPublish(overview, OVERVIEW_MARKDOWN)
  unpublished = (await createDocument('Half written')).id
  await harness.drainOutbox()
}, 60_000)

afterAll(async () => {
  await harness.close()
})

const previewDraft = (reference: string, cookies?: Record<string, string>) =>
  harness.app.inject({
    method: 'GET',
    url: `/preview/d/${reference}?draft`,
    ...(cookies === undefined ? {} : { cookies }),
  })

/** Saves a draft that says more than what is published, as autosave would. */
async function saveDraft(id: DocumentId, markdown: string): Promise<void> {
  const taken = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/lock/acquire`,
    cookies: editor,
  })
  expect(taken.statusCode).toBe(200)
  const current = await harness.app.inject({
    method: 'GET',
    url: `/api/documents/${id}/draft`,
    cookies: editor,
  })
  const { frontMatter, ast } = parseDocument(markdown)
  const write = await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    cookies: editor,
    payload: {
      ast: { version: 1, frontMatter, ast },
      expectedVersion: (current.json() as { draftVersion: number }).draftVersion,
    },
  })
  expect(write.statusCode).toBe(200)
  await harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/lock`, cookies: editor })
}

describe('the reader preview', () => {
  it('renders the document through the public site’s chrome, unpublished collection and all', async () => {
    const response = await preview(overviewRef, viewer)
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    const body = response.body
    expect(body).toContain('Acme is an API for moving widgets between warehouses.')
    expect(body).toContain('<header class="site-header">')
    expect(body).toContain('<article class="layout-grid prose"')
    expect(body).toContain('<p class="site-eyebrow">Architecture</p>')
    expect(body).toContain('<nav class="site-toc"')
    expect(body).toMatch(/<summary>\s*Architecture\s*<span class="site-nav-count">1<\/span>/u)
    expect(body).toMatch(/href="\/preview\/d\/overview-[0-9a-z]+"\s+aria-current="page"/u)
    expect(body).not.toContain('Half written')
    expect(body).toMatch(/<link rel="stylesheet" href="\/s\/_assets\/theme-[0-9a-f]{32}\.css" \/>/u)
    expect(body).toMatch(/<script src="\/s\/_assets\/scheme-[0-9a-f]{32}\.js"><\/script>/u)
    // The reader paints code and opens diagrams here exactly as on the public site.
    expect(body).toMatch(
      /<script type="module" src="\/s\/_assets\/reader-[0-9a-f]{32}\.js"><\/script>/u,
    )
  })

  it('carries the public header menu, resolved as a public page resolves it', async () => {
    const admin = await harness.cookiesFor(tenancy.admin)
    const current = await harness.app.inject({
      method: 'GET',
      url: '/api/settings/organisation',
      cookies: admin,
    })
    const { settings, revision } = current.json()
    const saved = await harness.app.inject({
      method: 'PUT',
      url: '/api/settings/organisation',
      cookies: admin,
      payload: {
        settings: {
          ...settings,
          publicMenu: [
            { kind: 'url', href: 'https://status.example.com', label: 'Status' },
            // Sent on a public page, but a preview's address is never sent anywhere.
            { kind: 'url', href: 'https://partner.test', label: 'Partner', referrer: 'sent' },
            // Not on the public web, so not in a reader's header either.
            { kind: 'document', id: overview },
          ],
        },
        expectedRevision: revision,
      },
    })
    expect(saved.statusCode).toBe(200)

    const header = /<header class="site-header">[\s\S]*?<\/header>/u.exec(
      (await preview(overviewRef, viewer)).body,
    )?.[0]
    expect(header).toContain('<nav class="site-bar" aria-label="Site">')
    expect(header).toMatch(/href="https:\/\/status\.example\.com"\s+rel="noopener noreferrer"/u)
    expect(header).not.toMatch(/site-bar-link" href="\/s\//u)
    expect(header).toMatch(/href="https:\/\/partner\.test"\s+rel="noopener noreferrer"/u)
  })

  it('accepts the id as well as the readable reference', async () => {
    expect((await preview(overview, viewer)).statusCode).toBe(200)
  })

  it('says it is a preview, and leads back to the document in the app', async () => {
    const body = (await preview(overviewRef, viewer)).body
    expect(body).toContain('<aside class="site-preview" aria-label="Reader preview">')
    expect(body).toContain('Not on the public web')
    expect(body).toContain(`href="/w/engineering/d/${overviewRef}"`)
    expect(body).toContain(
      `<title>Preview: Overview · ${defaultOrganisationSettings().name}</title>`,
    )
  })

  it('is never indexed and never kept by a shared cache', async () => {
    const response = await preview(overviewRef, viewer)
    expect(response.body).toContain('<meta name="robots" content="noindex,nofollow" />')
    expect(response.body).not.toContain('rel="canonical"')
    expect(response.body).not.toContain('application/ld+json')
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['etag']).toBeUndefined()
    // Tighter than the platform's default: a preview tells no other origin anything.
    expect(response.headers['referrer-policy']).toBe('no-referrer')
  })

  it('carries the platform’s strict Content-Security-Policy', async () => {
    const policy = String((await preview(overviewRef, viewer)).headers['content-security-policy'])
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toContain('unsafe-inline')
    expect(policy).toContain("frame-ancestors 'none'")
  })

  it('sends somebody who is not signed in to sign in, and back here afterwards', async () => {
    const response = await preview(overviewRef)
    expect(response.statusCode).toBe(303)
    expect(response.headers['location']).toBe(
      `/sign-in?redirect=${encodeURIComponent(`/preview/d/${overviewRef}`)}`,
    )
    expect(response.headers['cache-control']).toBe('private, no-store')
  })

  it('answers somebody who may not read the document exactly as it answers a missing one', async () => {
    const refused = await preview(overviewRef, outsider)
    const missing = await preview('nothing-k000000000', outsider)
    const unknownId = await preview('00000000-0000-4000-8000-0000000fffff', viewer)
    expect(unknownId.statusCode).toBe(404)
    expect(unknownId.body).toBe(missing.body)
    expect(refused.statusCode).toBe(404)
    expect(missing.statusCode).toBe(404)
    expect(refused.body).toBe(missing.body)
    expect(refused.headers['content-type']).toContain('text/html')
    expect(refused.body).not.toContain('Overview')
    expect(refused.body).toContain('<meta name="robots" content="noindex,nofollow" />')
  })

  it('says where the page is live once its collection is published', async () => {
    const admin = await harness.cookiesFor(tenancy.admin)
    const settings = await harness.app.inject({
      method: 'GET',
      url: '/api/settings/organisation',
      cookies: admin,
    })
    const current = settings.json() as {
      settings: ReturnType<typeof defaultOrganisationSettings>
      revision: string | null
    }
    const allowed = await harness.app.inject({
      method: 'PUT',
      url: '/api/settings/organisation',
      cookies: admin,
      payload: {
        settings: {
          ...current.settings,
          policies: { ...current.settings.policies, publicPublishingAllowed: true },
        },
        expectedRevision: current.revision,
      },
    })
    expect(allowed.statusCode).toBe(200)
    const published = await harness.app.inject({
      method: 'POST',
      url: `/api/collections/${tenancy.collectionId}/public`,
      cookies: admin,
      payload: { siteSlug: 'acme-docs' },
    })
    expect(published.statusCode).toBe(200)

    const body = (await preview(overviewRef, viewer)).body
    expect(body).toContain('Live on the web')
    expect(body).toContain('href="/s/acme-docs/architecture/overview"')
    expect(body).toContain('<a class="site-brand" href="/s/acme-docs">')
  })

  it('refuses to preview in somebody else’s colours when the settings cannot be read', async () => {
    const current = await harness.deps.contentStore.readFile(
      SYSTEM_WORKSPACE_ID,
      ORGANISATION_SETTINGS_PATH,
    )
    const before = current?.text ?? null
    await harness.deps.contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path: ORGANISATION_SETTINGS_PATH,
      text: `version: ${SETTINGS_VERSION + 1}\nname: From the future\n`,
      expected: before,
      author: { name: 'A newer release', email: 'future@example.com' },
    })
    try {
      const response = await preview(overviewRef, viewer)
      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('settings_unreadable')
      expect(response.headers['cache-control']).toBe('private, no-store')
    } finally {
      await harness.deps.contentStore.putFile({
        workspaceId: SYSTEM_WORKSPACE_ID,
        path: ORGANISATION_SETTINGS_PATH,
        text: before ?? '',
        expected: `version: ${SETTINGS_VERSION + 1}\nname: From the future\n`,
        author: { name: 'Restored', email: 'restore@example.com' },
      })
    }
  })

  it('shows a document with no published revision as the chrome around a note', async () => {
    const response = await preview(unpublished, editor)
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Nothing has been published yet')
    expect(response.body).toContain('site-preview')
  })
})

describe('the preview of a draft', () => {
  const DRAFT_LINE = 'A sentence that is only in the draft.'

  beforeAll(async () => {
    await saveDraft(overview, `${OVERVIEW_MARKDOWN}\n\n${DRAFT_LINE}\n`)
  })

  it('shows what an editor has saved and not published, as the page it would become', async () => {
    const response = await previewDraft(overviewRef, editor)

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain(DRAFT_LINE)
    expect(response.body).toContain('<article class="layout-grid prose"')
    expect(response.body).toContain('<nav class="site-toc"')
  })

  it('leaves the page everybody else sees as it is published', async () => {
    expect((await preview(overviewRef, editor)).body).not.toContain(DRAFT_LINE)
    expect((await preview(overviewRef, viewer)).body).not.toContain(DRAFT_LINE)
  })

  it('says it is the unpublished draft, and leads back to editing it', async () => {
    const body = (await previewDraft(overviewRef, editor)).body

    expect(body).toContain('Unpublished changes')
    expect(body).toContain(`href="/w/engineering/d/${overviewRef}/edit"`)
    expect(body).toContain(`href="/w/engineering/d/${overviewRef}"`)
  })

  it('is as private as the published preview, and never indexed', async () => {
    const response = await previewDraft(overviewRef, editor)

    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
    expect(response.body).toContain('<meta name="robots" content="noindex,nofollow" />')
  })

  it('is for somebody who may edit, and answers one who may only read as it answers a missing document', async () => {
    const refused = await previewDraft(overviewRef, viewer)
    const missing = await previewDraft('nothing-k000000000', viewer)

    expect(refused.statusCode).toBe(404)
    expect(refused.body).toBe(missing.body)
    expect(refused.body).not.toContain(DRAFT_LINE)
    expect((await previewDraft(overviewRef, outsider)).statusCode).toBe(404)
  })

  it('sends somebody who is not signed in to sign in, and back to the draft', async () => {
    const response = await previewDraft(overviewRef)

    expect(response.statusCode).toBe(303)
    expect(response.headers['location']).toBe(
      `/sign-in?redirect=${encodeURIComponent(`/preview/d/${overviewRef}?draft`)}`,
    )
  })

  it('answers a document that has no draft as it answers a missing one', async () => {
    const { id } = await createDocument('Draft lost')
    await harness.database.pool.query('DELETE FROM drafts WHERE document_id = $1', [id])
    const response = await previewDraft(id, editor)
    const missing = await previewDraft('nothing-k000000000', editor)

    expect(response.statusCode).toBe(404)
    expect(response.body).toBe(missing.body)
  })

  it('shows a document nobody has published, which the published preview has nothing to show of', async () => {
    const created = await createDocument('Brand new')
    const ref = documentReference({ title: 'Brand new', shortId: created.shortId })
    await saveDraft(created.id, '# Brand new\n\nNot out yet.\n')

    expect((await preview(ref, editor)).body).not.toContain('Not out yet.')
    expect((await previewDraft(ref, editor)).body).toContain('Not out yet.')
  })
})
