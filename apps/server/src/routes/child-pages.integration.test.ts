import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from '@quill/markdown'
import type { DocumentId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * `GET /api/documents/:id/children` over a real database (ADR-049): the
 * list a `::children` slot is filled with in the app, for this reader, and
 * kept fresh by the outbox.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>
let parent: DocumentId
let install: DocumentId
let linux: DocumentId

async function create(title: string, parentId?: DocumentId): Promise<DocumentId> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: {
      collectionId: tenancy.collectionId,
      title,
      ...(parentId === undefined ? {} : { parentId }),
    },
  })
  expect(response.statusCode).toBe(201)
  return response.json().document.id as DocumentId
}

async function publish(id: DocumentId, markdown: string): Promise<void> {
  const { frontMatter, ast } = parseDocument(markdown)
  expect(
    (
      await harness.app.inject({
        method: 'POST',
        url: `/api/documents/${id}/lock/acquire`,
        cookies: editor,
      })
    ).statusCode,
  ).toBe(200)
  const write = await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    cookies: editor,
    payload: { ast: { version: 1, frontMatter, ast }, expectedVersion: 0 },
  })
  expect(write.statusCode).toBe(200)
  const published = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/publish`,
    cookies: editor,
    payload: { base: null },
  })
  expect(published.statusCode).toBe(200)
  await harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/lock`, cookies: editor })
}

async function children(query: string, cookies = viewer, id = parent) {
  return await harness.app.inject({
    method: 'GET',
    url: `/api/documents/${id}/children${query}`,
    cookies,
  })
}

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)

  parent = await create('Guide')
  install = await create('Install', parent)
  linux = await create('Linux', install)
  await create('Roadmap', parent)
  await publish(install, '---\nicon: 📦\n---\n\n# Install\n\nHow to install it.\n')
  await publish(linux, '---\ndescription: Notes for Linux.\n---\n\n# Linux\n\nOn Linux.\n')
  await harness.drainOutbox()
}, 60_000)

afterAll(async () => {
  await harness.close()
})

describe('the children of a document', () => {
  it('lists one level by default, drafts marked as drafts, as private HTML', async () => {
    const response = await children('')
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-cache')
    const { html, count } = response.json<{ html: string; count: number }>()
    expect(count).toBe(2)
    expect(html).toMatch(
      /<a class="child-page-link" href="\/w\/engineering\/d\/install-[0-9a-z]{10}">/,
    )
    expect(html).toContain(
      '<span class="child-page-title">Roadmap</span></a><span class="badge" data-tone="neutral">Draft</span>',
    )
    expect(html).not.toContain('Linux')
  })

  it('goes deeper, with excerpts and icons from each page’s published head', async () => {
    const { html, count } = (await children('?depth=2&excerpts=true&icons=true&sort=title')).json<{
      html: string
      count: number
    }>()
    expect(count).toBe(3)
    expect(html).toContain('<span class="child-page-icon" aria-hidden="true">📦</span>')
    expect(html).toContain('<p class="child-page-excerpt">How to install it.</p>')
    expect(html).toMatch(/href="\/w\/engineering\/d\/linux-[0-9a-z]{10}"/)
    // A description, when a page has one, is its excerpt.
    expect(html).toContain('<p class="child-page-excerpt">Notes for Linux.</p>')
    // Sorted by title: Install before Roadmap.
    expect(html.indexOf('Install')).toBeLessThan(html.indexOf('Roadmap'))
  })

  it('never lists a page the reader may not read', async () => {
    const { repos } = harness.deps.uow
    await repos.grants.create({
      id: harness.deps.ids.uuid(),
      principalKind: 'user',
      principalId: tenancy.viewer,
      scopeKind: 'document',
      scopeId: install,
      role: 'viewer',
      effect: 'deny',
      createdBy: null,
      now: harness.clock.now(),
    })
    const { html } = (await children('?depth=3')).json<{ html: string }>()
    expect(html).not.toContain('Install')
    expect(html).not.toContain('Linux')
    expect(html).toContain('Roadmap')
    // The editor, who holds no deny, still sees it.
    expect((await children('?depth=3', editor)).json<{ html: string }>().html).toContain('Linux')
  })

  it('says so when a page has no children', async () => {
    const { html, count } = (await children('', editor, linux)).json<{
      html: string
      count: number
    }>()
    expect(count).toBe(0)
    expect(html).toBe('<p class="child-pages-empty">No child pages yet</p>')
  })

  it('shows a new child once the outbox has said so, and not from a stale subtree', async () => {
    expect((await children('', editor)).json<{ count: number }>().count).toBe(2)
    await create('Upgrade', parent)
    // The subtree is cached until the creation is delivered…
    expect((await children('', editor)).json<{ count: number }>().count).toBe(2)
    await harness.drainOutbox()
    // …and invalidated by it.
    expect((await children('', editor)).json<{ count: number }>().count).toBe(3)
  })

  it('refuses a reader without access, and options out of range', async () => {
    expect((await children('', outsider)).statusCode).toBeGreaterThanOrEqual(403)
    expect((await children('?depth=9')).statusCode).toBe(400)
    expect((await children('?sort=random')).statusCode).toBe(400)
  })
})

describe('on the server-assembled pages', () => {
  beforeAll(async () => {
    const admin = await harness.cookiesFor(tenancy.admin)
    const current = await harness.app.inject({
      method: 'GET',
      url: '/api/settings/organisation',
      cookies: admin,
    })
    const body = current.json<{ settings: Record<string, unknown>; revision: string | null }>()
    const policies = body.settings['policies'] as Record<string, unknown>
    const saved = await harness.app.inject({
      method: 'PUT',
      url: '/api/settings/organisation',
      cookies: admin,
      payload: {
        settings: { ...body.settings, policies: { ...policies, publicPublishingAllowed: true } },
        expectedRevision: body.revision,
      },
    })
    expect(saved.statusCode).toBe(200)
    const site = await harness.app.inject({
      method: 'POST',
      url: `/api/collections/${tenancy.collectionId}/public`,
      cookies: admin,
      payload: { siteSlug: 'guides' },
    })
    expect(site.statusCode).toBe(200)
    await publish(parent, '# Guide\n\n::children[In this guide]{depth=2 excerpts}\n')
    await harness.drainOutbox()
  }, 60_000)

  it('lists only published pages on the public site, at the site’s own addresses', async () => {
    const page = await harness.app.inject({ method: 'GET', url: '/s/guides/architecture/guide' })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain(
      '<p class="child-pages-title" id="user-content-children.1">In this guide</p><ul class="child-pages-list">',
    )
    expect(page.body).toContain('href="/s/guides/architecture/install"')
    expect(page.body).toContain('href="/s/guides/architecture/linux"')
    expect(page.body).toContain('<p class="child-page-excerpt">How to install it.</p>')
    // Drafts are not on the web.
    expect(page.body).not.toContain('Roadmap')
    expect(page.body).not.toContain('child-pages-fallback')
  })

  it('lists what the member may read in their preview, each opening its own preview', async () => {
    const preview = await harness.app.inject({
      method: 'GET',
      url: `/preview/d/${parent}`,
      cookies: editor,
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.body).toMatch(/href="\/preview\/d\/install-[^"]+"/)
    expect(preview.body).toContain('Roadmap')
  })
})
