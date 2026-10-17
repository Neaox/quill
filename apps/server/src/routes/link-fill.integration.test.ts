import { PUBLIC_PREVIEW_SCOPE, defaultOrganisationSettings } from '@quill/application'
import type { LinkPreviewPorts, OrganisationSettings } from '@quill/application'
import { compileLinkPolicy, ok } from '@quill/domain'
import type { DocumentId } from '@quill/domain'
import { parseDocument } from '@quill/markdown'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { PUBLIC_SITE_CACHE_TTL_MS } from '../public-site/cache.ts'
import { createLinkPreviewRateLimits } from '../infrastructure/link-preview/rate-limits.ts'
import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Link previews on the two reading surfaces (ADR-042): a signed-in member's
 * rendered body, and a published page. The member's read queues what is
 * missing; the public read only ever shows what is already stored.
 */

const SITE = 'linked-docs'
const LINK = 'https://blog.example/post'
const MARKDOWN = ['# Linked page', '', `Read :link[${LINK}]{display=card} first.`, ''].join('\n')
const PAGE = `/s/${SITE}/architecture/linked-page`

const policy = compileLinkPolicy({ mode: 'rich', allow: [], block: [] })
if (!policy.ok) throw new Error('policy')
const resolve = vi.fn<LinkPreviewPorts['resolver']['resolve']>(async (url) =>
  ok({
    url,
    canonicalUrl: url,
    title: 'A fetched title',
    description: null,
    siteName: null,
    kind: 'website',
    thumbnail: null,
    favicon: null,
    layer: 'page',
    fetchedAt: '2026-01-01T00:00:00.000Z',
  }),
)

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let admin: Record<string, string>
let documentId: DocumentId
let mayQueue = false

const rendered = (cookies: Record<string, string>, headers: Record<string, string> = {}) =>
  harness.app.inject({
    method: 'GET',
    url: `/api/documents/${documentId}/rendered`,
    cookies,
    headers,
  })

/** A fixture step that must have worked, stated where a hook can say so. */
function succeeded(response: { statusCode: number }): void {
  if (response.statusCode !== 200) throw new Error(`Fixture step answered ${response.statusCode}`)
}

/** A document written and published as the editor, as the page would be. */
async function publishDocument(title: string, markdown: string): Promise<DocumentId> {
  const created = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: { collectionId: tenancy.collectionId, title },
  })
  const id = created.json().document.id as DocumentId
  await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/lock/acquire`,
    cookies: editor,
  })
  const { frontMatter, ast } = parseDocument(markdown)
  await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    cookies: editor,
    payload: { ast: { version: 1, frontMatter, ast }, expectedVersion: 0 },
  })
  await harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/lock`, cookies: editor })
  const published = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/publish`,
    cookies: editor,
    payload: { base: null },
  })
  succeeded(published)
  return id
}

beforeAll(async () => {
  harness = await createServerHarness({
    linkPreviewPorts: {
      audiences: {
        forPerson: async () => ({ scope: PUBLIC_PREVIEW_SCOPE, policy: policy.value }),
        forPublic: async () => ({ scope: PUBLIC_PREVIEW_SCOPE, policy: policy.value }),
      },
      resolver: { resolve },
      limits: {
        ...createLinkPreviewRateLimits({ now: () => harness.clock.now() }),
        // Off until a test turns it on, so what a publish or a read would have queued is the test's to choose.
        allowQueued: (_person, count) => (mayQueue ? count : 0),
      },
    },
  })
  tenancy = await seedTenancy(harness)
  editor = await harness.cookiesFor(tenancy.editor)
  admin = await harness.cookiesFor(tenancy.admin)

  const current = (
    await harness.app.inject({ method: 'GET', url: '/api/settings/organisation', cookies: admin })
  ).json() as { settings: OrganisationSettings; revision: string | null }
  const saved = await harness.app.inject({
    method: 'PUT',
    url: '/api/settings/organisation',
    cookies: admin,
    payload: {
      settings: {
        ...current.settings,
        policies: { ...defaultOrganisationSettings().policies, publicPublishingAllowed: true },
      },
      expectedRevision: current.revision,
    },
  })
  succeeded(saved)

  documentId = await publishDocument('Linked page', MARKDOWN)
  await harness.drainOutbox()
  resolve.mockClear()
  const site = await harness.app.inject({
    method: 'POST',
    url: `/api/collections/${tenancy.collectionId}/public`,
    cookies: admin,
    payload: { siteSlug: SITE, homeDocumentId: documentId },
  })
  succeeded(site)
}, 60_000)

afterAll(async () => {
  await harness.close()
})

describe('a published page, read by a stranger', () => {
  it('shows a link nobody has previewed as the plain link it is, and fetches nothing', async () => {
    const page = await harness.app.inject({ method: 'GET', url: PAGE })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain(`href="${LINK}"`)
    expect(page.body).not.toContain('A fetched title')
    await harness.drainOutbox()
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('the rendered body, read by a member', () => {
  it('shows the link plain, and says a preview is on its way when nothing could be queued', async () => {
    const response = await rendered(editor)
    expect(response.statusCode).toBe(200)
    expect(response.json().html).toContain('data-link-slot')
    expect(response.json().pendingLinks).toBe(1)
  })

  it('draws the preview once the fetch has run, under a new tag', async () => {
    const before = await rendered(editor)
    mayQueue = true
    expect((await rendered(editor)).json().pendingLinks).toBe(1)
    await harness.drainOutbox()
    expect(resolve).toHaveBeenCalledOnce()

    const after = await rendered(editor)
    expect(after.json().html).toContain('A fetched title')
    expect(after.json().html).not.toContain('data-link-slot')
    expect(after.json().pendingLinks).toBe(0)
    expect(after.headers['etag']).not.toBe(before.headers['etag'])
  })

  it('answers 304 to a repeat read of the same drawing, and not to an older tag', async () => {
    const current = String((await rendered(editor)).headers['etag'])
    expect((await rendered(editor, { 'if-none-match': current })).statusCode).toBe(304)
    const bare = current.replace(/-[^-"]+"$/u, '"')
    expect((await rendered(editor, { 'if-none-match': bare })).statusCode).toBe(200)
  })
})

describe('publishing', () => {
  it('queues the previews of its links, so the first reader finds them stored', async () => {
    const other = 'https://other.example/story'
    resolve.mockClear()
    await publishDocument('Warmed page', `Also :link[${other}]{display=card}.`)
    await harness.drainOutbox()
    expect(resolve.mock.calls.map(([url]) => url)).toEqual([other])
  })
})

describe('a published page, once the link has been previewed', () => {
  it('draws the stored preview for a stranger as soon as the page is rebuilt', async () => {
    harness.clock.advance(PUBLIC_SITE_CACHE_TTL_MS)
    const page = await harness.app.inject({ method: 'GET', url: PAGE })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('A fetched title')
  })
})
