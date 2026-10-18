import { defaultOrganisationSettings } from '@quill/application'
import type {
  LinkPreviewPorts,
  LinkPreviewSettings,
  OrganisationSettings,
} from '@quill/application'
import { ok } from '@quill/domain'
import type { DocumentId } from '@quill/domain'
import { parseDocument } from '@quill/markdown'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { linkPublicPolicy, linkSettingsPolicy } from '../application/link-settings.ts'
import { PUBLIC_SITE_CACHE_TTL_MS } from '../public-site/cache.ts'
import { createLinkPreviewAudiences } from '../infrastructure/link-preview/audiences.ts'
import { createLinkPreviewRateLimits } from '../infrastructure/link-preview/rate-limits.ts'
import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The organisation's link settings, end to end (ADR-042, "Policy"): saved
 * through the settings API, they decide what Quill fetches, what a member's
 * page and the public site draw, and how a link nobody chose a display for
 * looks. The previews are fetched and stored by the real audiences, so the
 * test is also the proof that a restrictive policy never shows a preview
 * fetched under a looser one (security review S10).
 */

const SITE = 'link-settings-docs'
const LINK = 'https://blog.example/post'
const PAGE = `/s/${SITE}/architecture/linked-page`

const resolve = vi.fn<LinkPreviewPorts['resolver']['resolve']>(async (url, options) =>
  ok({
    url,
    canonicalUrl: url,
    title: options?.policy?.images === false ? 'Words only' : 'A rich title',
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

const LOOSE: LinkPreviewSettings = {
  mode: 'rich',
  publicSite: true,
  defaultDisplay: 'inline',
  allow: [],
  block: [],
}

/** A fixture step that must have worked, stated where a hook can say so. */
function succeeded(response: { statusCode: number }): void {
  if (response.statusCode !== 200) throw new Error(`Fixture step answered ${response.statusCode}`)
}

async function readSettings() {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/settings/organisation',
    cookies: admin,
  })
  return response.json() as { settings: OrganisationSettings; revision: string | null }
}

/** Saves the organisation's link settings, keeping everything else as it is. */
async function saveLinks(linkPreviews: LinkPreviewSettings | undefined) {
  const current = await readSettings()
  const { linkPreviews: _previous, ...rest } = current.settings
  return harness.app.inject({
    method: 'PUT',
    url: '/api/settings/organisation',
    cookies: admin,
    payload: {
      settings: { ...rest, ...(linkPreviews === undefined ? {} : { linkPreviews }) },
      expectedRevision: current.revision,
    },
  })
}

async function saveLinksOk(linkPreviews: LinkPreviewSettings | undefined) {
  const response = await saveLinks(linkPreviews)
  if (response.statusCode !== 200) throw new Error(`Settings answered ${response.statusCode}`)
}

const rendered = () =>
  harness.app.inject({
    method: 'GET',
    url: `/api/documents/${documentId}/rendered`,
    cookies: editor,
  })

/** A member's read, then the fetch it queued, as the page would have it. */
async function memberReadsAndFetches() {
  await rendered()
  await harness.drainOutbox()
  return (await rendered()).json() as { html: string; pendingLinks: number }
}

async function publicPage() {
  harness.clock.advance(PUBLIC_SITE_CACHE_TTL_MS)
  return (await harness.app.inject({ method: 'GET', url: PAGE })).body
}

beforeAll(async () => {
  harness = await createServerHarness({
    linkPreviewPorts: {
      audiences: createLinkPreviewAudiences(
        () => linkSettingsPolicy(harness.deps.settings),
        () => linkPublicPolicy(harness.deps.settings),
      ),
      resolver: { resolve },
      limits: createLinkPreviewRateLimits({ now: () => harness.clock.now() }),
    },
  })
  tenancy = await seedTenancy(harness)
  editor = await harness.cookiesFor(tenancy.editor)
  admin = await harness.cookiesFor(tenancy.admin)

  const current = await readSettings()
  const published = await harness.app.inject({
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
  succeeded(published)

  const created = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: { collectionId: tenancy.collectionId, title: 'Linked page' },
  })
  documentId = created.json().document.id as DocumentId
  await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${documentId}/lock/acquire`,
    cookies: editor,
  })
  const { frontMatter, ast } = parseDocument(`# Linked page\n\n::link{url="${LINK}"}\n`)
  await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${documentId}/draft`,
    cookies: editor,
    payload: { ast: { version: 1, frontMatter, ast }, expectedVersion: 0 },
  })
  await harness.app.inject({
    method: 'DELETE',
    url: `/api/documents/${documentId}/lock`,
    cookies: editor,
  })
  const publish = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${documentId}/publish`,
    cookies: editor,
    payload: { base: null },
  })
  succeeded(publish)
  await harness.drainOutbox()
  const site = await harness.app.inject({
    method: 'POST',
    url: `/api/collections/${tenancy.collectionId}/public`,
    cookies: admin,
    payload: { siteSlug: SITE, homeDocumentId: documentId },
  })
  succeeded(site)
}, 60_000)

beforeEach(async () => {
  resolve.mockClear()
  // Each test starts with nothing fetched, so what it sees is what its own policy fetched.
  await harness.database.pool.query('DELETE FROM link_previews')
  await saveLinksOk(LOOSE)
})

afterAll(async () => {
  await harness.close()
})

describe('saving the link settings', () => {
  it('reads back what was saved, and an organisation that never saved any reads as the defaults', async () => {
    await saveLinksOk({ ...LOOSE, defaultDisplay: 'compact', block: ['ads.example'] })
    expect((await readSettings()).settings.linkPreviews).toEqual({
      ...LOOSE,
      defaultDisplay: 'compact',
      block: ['ads.example'],
    })
  })

  it('refuses a pattern that is not a host, with the list, the place and the reason', async () => {
    const response = await saveLinks({ ...LOOSE, block: ['fine.example', 'not a host'] })
    expect(response.statusCode).toBe(422)
    const { error } = response.json()
    expect(error.code).toBe('invalid_settings')
    expect(error.details.issues).toEqual([
      expect.objectContaining({
        path: '/linkPreviews/block/1',
        rule: 'link-pattern',
        message: expect.stringContaining('not a host'),
      }),
    ])
    // Nothing was saved: the loose settings from the hook still stand.
    expect((await readSettings()).settings.linkPreviews).toEqual(LOOSE)
  })

  it('is for an instance administrator only', async () => {
    const current = await readSettings()
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/api/settings/organisation',
      cookies: editor,
      payload: {
        settings: { ...current.settings, linkPreviews: { ...LOOSE, mode: 'off' } },
        expectedRevision: current.revision,
      },
    })
    expect(response.statusCode).toBe(403)
  })

  it('is audited, as an event of its own, without a single pattern in it', async () => {
    await saveLinksOk({ ...LOOSE, mode: 'text', block: ['secret-project.example'] })
    const { rows } = await harness.database.pool.query(
      "SELECT metadata FROM audit_events WHERE type = 'settings.link_previews.changed' ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].metadata).toMatchObject({ to: { mode: 'text', block: 1 } })
    expect(JSON.stringify(rows[0].metadata)).not.toContain('secret-project')
  })
})

describe('the default display', () => {
  it('draws a bare link the way the organisation chose, for a member', async () => {
    await saveLinksOk({ ...LOOSE, defaultDisplay: 'card' })
    const { html } = await memberReadsAndFetches()
    expect(html).toContain('link-card')
    await saveLinksOk({ ...LOOSE, defaultDisplay: 'compact' })
    expect((await rendered()).json().html).toContain('link-compact')
    await saveLinksOk({ ...LOOSE, defaultDisplay: 'url' })
    expect((await rendered()).json().html).not.toContain('A rich title')
  })
})

describe('the public site', () => {
  it('draws stored previews while the organisation allows it, and plain links once it does not', async () => {
    await memberReadsAndFetches()
    expect(await publicPage()).toContain('A rich title')

    await saveLinksOk({ ...LOOSE, publicSite: false })
    const page = await publicPage()
    expect(page).toContain(`href="${LINK}"`)
    expect(page).not.toContain('A rich title')

    await saveLinksOk({ ...LOOSE, publicSite: true })
    expect(await publicPage()).toContain('A rich title')
  })
})

describe('a restrictive policy is never shown what a looser one fetched', () => {
  it('fetches again under the tighter policy, and until then draws the plain link everywhere', async () => {
    // Fetched, stored and shown under the loose policy.
    const loose = await memberReadsAndFetches()
    expect(loose.html).toContain('A rich title')
    expect(await publicPage()).toContain('A rich title')
    expect(resolve).toHaveBeenCalledOnce()

    // Tightened to text only: the stored rich preview is not this audience's to see.
    await saveLinksOk({ ...LOOSE, mode: 'text' })
    const afterTightening = (await rendered()).json()
    expect(afterTightening.html).not.toContain('A rich title')
    expect(afterTightening.pendingLinks).toBe(1)
    expect(await publicPage()).not.toContain('A rich title')

    // The next fetch runs under the tighter policy and is stored where only that policy reads.
    resolve.mockClear()
    await harness.drainOutbox()
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve.mock.calls[0]?.[1]?.policy?.images).toBe(false)
    expect((await rendered()).json().html).toContain('Words only')
    expect(await publicPage()).toContain('Words only')

    // And back: the loose scope still holds its own preview, fresh, with no new fetch.
    resolve.mockClear()
    await saveLinksOk(LOOSE)
    expect((await rendered()).json().html).toContain('A rich title')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('does not draw a preview of a site the organisation then blocks, from any scope', async () => {
    await memberReadsAndFetches()
    await saveLinksOk({ ...LOOSE, block: ['blog.example'] })
    expect((await rendered()).json().html).not.toContain('A rich title')
    expect(await publicPage()).not.toContain('A rich title')
  })

  it('turns previews off for everyone, the public site included', async () => {
    await memberReadsAndFetches()
    await saveLinksOk({ ...LOOSE, mode: 'off' })
    expect((await rendered()).json().html).not.toContain('A rich title')
    expect(await publicPage()).not.toContain('A rich title')
  })
})
