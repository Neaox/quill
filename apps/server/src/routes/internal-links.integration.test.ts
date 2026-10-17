import { PUBLIC_PREVIEW_SCOPE, createGrant, defaultOrganisationSettings } from '@quill/application'
import type { LinkPreviewPorts, OrganisationSettings } from '@quill/application'
import { compileLinkPolicy } from '@quill/domain'
import type { CollectionId, DocumentId } from '@quill/domain'
import { parseDocument } from '@quill/markdown'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { PUBLIC_SITE_CACHE_TTL_MS } from '../public-site/cache.ts'
import { createLinkPreviewRateLimits } from '../infrastructure/link-preview/rate-limits.ts'
import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Links to other documents (ADR-042, "Internal links"): the title is the
 * document's own, read for the reader, and a reader who may not see the
 * document is shown a plain label and never the title. Nothing is fetched and
 * nothing is stored, so there is nothing to go stale.
 */

const SITE = 'runbooks-site'
const resolve = vi.fn<LinkPreviewPorts['resolver']['resolve']>()
const policy = compileLinkPolicy({ mode: 'rich', allow: [], block: [] })
if (!policy.ok) throw new Error('policy')

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let viewer: Record<string, string>
let admin: Record<string, string>
let privateCollection: CollectionId
let runbook: DocumentId
let secret: DocumentId
let page: DocumentId

function succeeded(response: { statusCode: number }): void {
  if (response.statusCode !== 200) throw new Error(`Fixture step answered ${response.statusCode}`)
}

async function publishDocument(
  collectionId: CollectionId,
  title: string,
  markdown: string,
): Promise<DocumentId> {
  const created = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: { collectionId, title },
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
  succeeded(
    await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/publish`,
      cookies: editor,
      payload: { base: null },
    }),
  )
  return id
}

const rendered = (cookies: Record<string, string>) =>
  harness.app.inject({ method: 'GET', url: `/api/documents/${page}/rendered`, cookies })

beforeAll(async () => {
  harness = await createServerHarness({
    linkPreviewPorts: {
      audiences: {
        forPerson: async () => ({ scope: PUBLIC_PREVIEW_SCOPE, policy: policy.value }),
        forPublic: async () => ({ scope: PUBLIC_PREVIEW_SCOPE, policy: policy.value }),
      },
      resolver: { resolve },
      limits: createLinkPreviewRateLimits({ now: () => harness.clock.now() }),
    },
  })
  tenancy = await seedTenancy(harness)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  admin = await harness.cookiesFor(tenancy.admin)

  const current = (
    await harness.app.inject({ method: 'GET', url: '/api/settings/organisation', cookies: admin })
  ).json() as { settings: OrganisationSettings; revision: string | null }
  succeeded(
    await harness.app.inject({
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
    }),
  )

  const second = await harness.deps.uow.repos.collections.create({
    id: harness.deps.ids.uuid() as CollectionId,
    workspaceId: tenancy.workspaceId,
    name: 'Private',
    slug: 'private',
    now: harness.clock.now(),
  })
  privateCollection = second.id as CollectionId

  runbook = await publishDocument(
    tenancy.collectionId,
    'Deploy runbook',
    'Ship it on Tuesdays.\n\nMore.\n',
  )
  secret = await publishDocument(privateCollection, 'Secret plan', 'The plan.\n')
  page = await publishDocument(
    tenancy.collectionId,
    'Index',
    [
      `::link{url="/d/${runbook}" display=card}`,
      '',
      `::link{url="/d/${secret}" display=card}`,
      '',
      `See :link[/d/${runbook}]{display=inline} and :link[the plan]{url="/d/${secret}"}.`,
      '',
    ].join('\n'),
  )
  succeeded(
    await harness.app.inject({
      method: 'POST',
      url: `/api/collections/${tenancy.collectionId}/public`,
      cookies: admin,
      payload: { siteSlug: SITE, homeDocumentId: page },
    }),
  )
}, 60_000)

afterAll(async () => {
  await harness.close()
})

describe('the rendered body, read by a member', () => {
  it('draws a linked document with its own title, first paragraph and place, and fetches nothing', async () => {
    const html = (await rendered(editor)).json().html as string
    expect(html).toContain('Deploy runbook')
    expect(html).toContain('Ship it on Tuesdays.')
    expect(html).toContain('Architecture')
    expect(html).toContain(`href="/d/${runbook}"`)
    await harness.drainOutbox()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('counts a link to a document as nothing to wait for', async () => {
    expect((await rendered(editor)).json().pendingLinks).toBe(0)
  })

  it('shows a reader without access to a document a plain label, never its title', async () => {
    succeeded(
      await harness.app.inject({
        method: 'GET',
        url: `/api/documents/${page}/rendered`,
        cookies: viewer,
      }),
    )
    const granted = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.viewer,
      scopeKind: 'document',
      scopeId: secret,
      role: 'viewer',
      effect: 'deny',
      createdBy: tenancy.admin,
    })
    expect(granted.kind).toBe('created')

    const html = (await rendered(viewer)).json().html as string
    expect(html).toContain('Deploy runbook')
    expect(html).not.toContain('Secret plan')
    expect(html).not.toContain('The plan.')
    expect(html).not.toContain(`/d/${secret}`)
    expect(html).toContain('link-unavailable')
    // The words an author wrote are the author's, and stay.
    expect(html).toContain('>the plan<')
  })

  it('still shows the editor the document they may see', async () => {
    expect(((await rendered(editor)).json().html as string).includes('Secret plan')).toBe(true)
  })

  it('shows a rename on the next read, under a new tag', async () => {
    const before = await rendered(editor)
    succeeded(
      await harness.app.inject({
        method: 'PATCH',
        url: `/api/documents/${runbook}`,
        cookies: admin,
        payload: { title: 'Release runbook' },
      }),
    )
    const after = await rendered(editor)
    expect(after.json().html).toContain('Release runbook')
    expect(after.json().html).not.toContain('Deploy runbook')
    expect(after.headers['etag']).not.toBe(before.headers['etag'])
  })
})

describe('the link preview lookup the editor uses', () => {
  const lookup = (urls: string[], cookies: Record<string, string>) =>
    harness.app.inject({
      method: 'POST',
      url: '/api/link-previews/resolve',
      payload: JSON.stringify({ urls }),
      headers: { 'content-type': 'application/json' },
      cookies,
    })

  it('answers a document address with its live title', async () => {
    const response = await lookup([`/d/${runbook}`], editor)
    expect(response.json().previews[0].view).toMatchObject({
      state: 'ready',
      preview: { title: 'Release runbook', layer: 'internal', canonicalUrl: `/d/${runbook}` },
    })
  })

  it('answers a document the reader may not see exactly as one that does not exist', async () => {
    const response = await lookup(
      [`/d/${secret}`, '/d/00000000-0000-4000-8000-0000000009ff'],
      viewer,
    )
    const [denied, missing] = response.json().previews
    expect(denied.view).toEqual({ state: 'blocked' })
    expect(missing.view).toEqual({ state: 'blocked' })
  })

  it('keeps the order of a mixed list of documents and pages', async () => {
    const response = await lookup(['https://blog.example/x', `/d/${runbook}`, 'nope'], editor)
    expect(response.json().previews.map((entry: { url: string }) => entry.url)).toEqual([
      'https://blog.example/x',
      `/d/${runbook}`,
      'nope',
    ])
    expect(response.json().previews[1].view.state).toBe('ready')
  })
})

describe('a published page, read by a stranger', () => {
  const PAGE = `/s/${SITE}/architecture/index`

  it('previews a document published on the same site and links to its public page', async () => {
    harness.clock.advance(PUBLIC_SITE_CACHE_TTL_MS)
    const response = await harness.app.inject({ method: 'GET', url: PAGE })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Release runbook')
    expect(response.body).toContain(`href="/s/${SITE}/architecture/release-runbook"`)
    expect(response.body).not.toContain(`href="/d/${runbook}"`)
  })

  it('shows a document that is not on the site as a plain label, never its title', async () => {
    const response = await harness.app.inject({ method: 'GET', url: PAGE })
    expect(response.body).not.toContain('Secret plan')
    expect(response.body).not.toContain(`/d/${secret}`)
    expect(response.body).toContain('link-unavailable')
    expect(resolve).not.toHaveBeenCalled()
  })
})
