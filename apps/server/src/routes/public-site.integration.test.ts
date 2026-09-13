import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createGrant,
  defaultOrganisationSettings,
  ORGANISATION_SETTINGS_PATH,
  SETTINGS_VERSION,
  SYSTEM_WORKSPACE_ID,
} from '@quill/application'
import type { OrganisationSettings } from '@quill/application'
import { pngFile } from '@quill/application/test-support'
import { parseDocument } from '@quill/markdown'
import type { CollectionId, DocumentId } from '@quill/domain'

import { PUBLIC_SITE_CACHE_TTL_MS } from '../public-site/cache.ts'
import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The public site end to end (ADR-023, use cases 27–30), over a real database,
 * the real content store, the real Markdown pipeline and the real theme
 * generator.
 *
 * Everything a public page has to be true about is asserted here, because it
 * is only true *here*: the page is HTML in the first response, there is no
 * session read, there is no application chrome, a draft is nowhere, a
 * carved-out document is absent from all three places it could appear, an old
 * address still works, and the sitemap lists current paths only.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let admin: Record<string, string>

const SITE = 'acme-docs'

/** The two documents the site is made of, and the one taken off it. */
let overview: DocumentId
let rateLimits: DocumentId
let salaries: DocumentId

const OVERVIEW_MARKDOWN = [
  '# Overview',
  '',
  'Acme is an API for moving widgets between warehouses.',
  '',
  '## Getting started',
  '',
  'Create a key, then call the API.',
].join('\n')

const RATE_LIMITS_MARKDOWN = [
  '# Rate limits',
  '',
  'Every key is limited to one hundred requests a minute.',
  '',
  '## Bursts',
  '',
  'A burst of twenty is allowed.',
].join('\n')

const SALARIES_MARKDOWN = ['# Salaries', '', 'Not for the web.'].join('\n')

async function createDocument(title: string): Promise<DocumentId> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: { collectionId: tenancy.collectionId, title },
  })
  expect(response.statusCode).toBe(201)
  return response.json().document.id as DocumentId
}

async function writeDraft(id: DocumentId, markdown: string, expectedVersion: number) {
  const acquired = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/lock/acquire`,
    cookies: editor,
  })
  expect(acquired.statusCode).toBe(200)
  const { frontMatter, ast } = parseDocument(markdown)
  const write = await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    cookies: editor,
    payload: { ast: { version: 1, frontMatter, ast }, expectedVersion },
  })
  expect(write.statusCode).toBe(200)
  await harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/lock`, cookies: editor })
  return write.json().draftVersion as number
}

/** A publish that may fail, for a test that wants to see the answer. */
async function publishFrom(id: DocumentId, base: string | null) {
  return harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/publish`,
    cookies: editor,
    payload: { base },
  })
}

async function publish(id: DocumentId, base: string | null): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/publish`,
    cookies: editor,
    payload: { base },
  })
  expect(response.statusCode).toBe(200)
  return response.json().revision as string
}

/** A document written and published in one step, for a fixture. */
async function writePublished(title: string, markdown: string): Promise<DocumentId> {
  const id = await createDocument(title)
  await writeDraft(id, markdown, 0)
  await publish(id, null)
  return id
}

/** A fixture step that must have worked, stated where a hook can say so. */
function succeeded(response: { statusCode: number }, status = 200): void {
  expect(response.statusCode).toBe(status)
}

/** The stylesheet a page links to, which every page links to exactly one of. */
function stylesheetIn(body: string): string {
  const href = /href="(\/s\/_assets\/theme-[0-9a-f]{32}\.css)"/u.exec(body)?.[1]
  expect(href).toBeDefined()
  return href ?? ''
}

/** Puts the organisation's settings where a test needs them, through the API. */
async function settings(patch: Partial<OrganisationSettings>): Promise<void> {
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
    payload: { settings: { ...body.settings, ...patch }, expectedRevision: body.revision },
  })
  expect(response.statusCode).toBe(200)
}

const allowPublishing = (allowed: boolean) =>
  settings({
    policies: { ...defaultOrganisationSettings().policies, publicPublishingAllowed: allowed },
  })

async function publishSite(siteSlug = SITE, body: Record<string, unknown> = {}) {
  return harness.app.inject({
    method: 'POST',
    url: `/api/collections/${tenancy.collectionId}/public`,
    cookies: admin,
    payload: { siteSlug, ...body },
  })
}

/** A second collection in the same workspace, published as a site of its own. */
async function publishAnotherSite(name: string, siteSlug: string): Promise<CollectionId> {
  const created = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/collections`,
    cookies: admin,
    payload: { name },
  })
  expect(created.statusCode).toBe(201)
  const id = created.json().id as CollectionId
  const published = await harness.app.inject({
    method: 'POST',
    url: `/api/collections/${id}/public`,
    cookies: admin,
    payload: { siteSlug },
  })
  expect(published.statusCode).toBe(200)
  return id
}

/** The page without its per-response CSP nonces, which are the one part that varies. */
const withoutNonces = (body: string): string => body.replaceAll(/nonce="[^"]*"/gu, 'nonce=""')

/** An anonymous request: no cookies at all, ever, on this surface. */
const get = (url: string, headers: Record<string, string> = {}) =>
  harness.app.inject({ method: 'GET', url, headers })

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  editor = await harness.cookiesFor(tenancy.editor)
  admin = await harness.cookiesFor(tenancy.admin)

  await settings({ name: 'Acme', publicNavigation: [{ label: 'Status', href: 'https://s.test' }] })
  await allowPublishing(true)

  overview = await writePublished('Overview', OVERVIEW_MARKDOWN)
  rateLimits = await writePublished('Rate limits', RATE_LIMITS_MARKDOWN)
  salaries = await writePublished('Salaries', SALARIES_MARKDOWN)
  await harness.drainOutbox()

  succeeded(await publishSite(SITE, { homeDocumentId: overview }))
}, 60_000)

afterAll(async () => {
  await harness.close()
})

describe('the site home', () => {
  it('renders the home document as HTML in the first response, with no sign-in wall', async () => {
    const response = await get(`/s/${SITE}`)
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('Acme is an API for moving widgets between warehouses.')
    expect(response.body).not.toContain('sign in')
  })

  it('carries the landmarks, the tenant’s header and the site navigation', async () => {
    const body = (await get(`/s/${SITE}`)).body
    expect(body).toContain('<header class="site-header">')
    expect(body).toContain('<main class="site-main" id="site-main">')
    expect(body).toContain('<nav class="site-nav"')
    expect(body).toContain('<a class="site-brand" href="/s/acme-docs">Acme</a>')
    expect(body).toContain('href="https://s.test"')
    expect(body).toContain('href="/s/acme-docs/architecture/rate-limits"')
  })

  it('carries none of the application shell', async () => {
    const body = (await get(`/s/${SITE}`)).body
    for (const chrome of ['workspace switcher', 'account menu', 'comment panel', 'data-lock']) {
      expect(body).not.toContain(chrome)
    }
  })

  it('shows an index when the collection has no home document', async () => {
    expect((await publishSite(SITE, { homeDocumentId: null })).statusCode).toBe(200)
    const body = (await get(`/s/${SITE}`)).body
    expect(body).toContain('<h1>Architecture</h1>')
    expect(body).toContain('class="site-index"')
    // And the second view is the same page, answered from what was kept.
    expect((await get(`/s/${SITE}`)).body).toBe(body)
    expect((await publishSite(SITE, { homeDocumentId: overview })).statusCode).toBe(200)
  })
})

describe('a document page', () => {
  const path = `/s/${SITE}/architecture/rate-limits`

  it('renders the published body, its contents and its footer', async () => {
    const response = await get(path)
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Every key is limited to one hundred requests a minute.')
    expect(response.body).toContain('<article class="layout-grid prose"')
    expect(response.body).toContain('<nav class="site-toc"')
    expect(response.body).toContain('Bursts')
    expect(response.body).toContain('<time datetime=')
  })

  it('carries the canonical link, the description and the Open Graph tags a crawler reads', async () => {
    const body = (await get(path)).body
    expect(body).toContain(`<link rel="canonical" href="${harness.deps.config.appUrl}${path}" />`)
    expect(body).toContain(
      '<meta name="description" content="Every key is limited to one hundred requests a minute." />',
    )
    expect(body).toContain('<meta property="og:title" content="Rate limits" />')
    expect(body).toContain('<meta property="og:site_name" content="Acme" />')
    expect(body).toContain('"@type":"Article"')
  })

  it('is never noindex', async () => {
    const response = await get(path)
    expect(response.headers['x-robots-tag']).toBeUndefined()
    expect(response.body).not.toContain('noindex')
  })

  it('carries a strict Content-Security-Policy with a nonce and no unsafe-inline', async () => {
    const policy = String((await get(path)).headers['content-security-policy'])
    expect(policy).toContain("default-src 'self'")
    expect(policy).toMatch(/script-src [^;]*'nonce-/u)
    expect(policy).not.toContain('unsafe-inline')
    expect(policy).not.toContain('unsafe-eval')
    expect(policy).toContain("frame-ancestors 'none'")
  })

  it('answers 304 to a reader that already holds the page', async () => {
    const first = await get(path)
    const etag = String(first.headers['etag'])
    expect(etag).toMatch(/^"[0-9a-f]+"$/u)
    expect(first.headers['cache-control']).toContain('s-maxage')

    const again = await get(path, { 'if-none-match': etag })
    expect(again.statusCode).toBe(304)
    expect(again.body).toBe('')
  })

  it('reads no session: the page is the same for a member as for a stranger', async () => {
    const anonymous = await get(path)
    const signedIn = await harness.app.inject({ method: 'GET', url: path, cookies: editor })
    expect(signedIn.statusCode).toBe(200)
    // Byte for byte, once the per-response CSP nonce is accounted for — which
    // is also why the nonce is not part of the page's ETag.
    expect(withoutNonces(signedIn.body)).toBe(withoutNonces(anonymous.body))
    expect(signedIn.headers['etag']).toBe(anonymous.headers['etag'])
  })

  it('shows the published revision, never a draft', async () => {
    await writeDraft(rateLimits, `${RATE_LIMITS_MARKDOWN}\n\nA secret unpublished sentence.`, 1)
    const body = (await get(path)).body
    expect(body).toContain('Every key is limited to one hundred requests a minute.')
    expect(body).not.toContain('A secret unpublished sentence.')
  })
})

describe('a document carved out of the site', () => {
  const path = `/s/${SITE}/architecture/salaries`

  it('is on the site until the deny is written', async () => {
    expect((await get(path)).statusCode).toBe(200)
  })

  it('is absent from the navigation, from the sitemap, and from its own address', async () => {
    // Through the use case, which is what an access screen will call: the
    // grants API route is the web half's work, and the command is the same
    // one either way (ADR-012).
    const denied = await createGrant(harness.deps, {
      principalKind: 'public',
      principalId: null,
      scopeKind: 'document',
      scopeId: salaries,
      role: 'viewer',
      effect: 'deny',
      createdBy: tenancy.admin,
    })
    expect(denied.kind).toBe('created')
    // A grant is not an outbox event, so the cache in front of the site is
    // told directly — which is what the access screen's route will do when it
    // is built, and what the time to live does for anything that forgets.
    harness.deps.publicSiteCache.invalidate()

    expect((await get(path)).statusCode).toBe(404)
    expect((await get(`/s/${SITE}`)).body).not.toContain('architecture/salaries')
    expect((await get(`/s/${SITE}/sitemap.xml`)).body).not.toContain('architecture/salaries')
  })

  it('is still readable by the people who maintain it', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${salaries}`,
      cookies: editor,
    })
    expect(response.statusCode).toBe(200)
  })

  it('answers the site’s own not-found page, in the same template', async () => {
    const response = await get(path)
    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('That page is not here')
    expect(response.body).toContain('<header class="site-header">')
    expect(response.body).not.toContain('rel="canonical"')
  })
})

describe('an address that has moved', () => {
  it('answers 301 at the old path after a rename, and 200 at the new one', async () => {
    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${rateLimits}`,
      cookies: admin,
      payload: { title: 'Throttling' },
    })
    expect(renamed.statusCode).toBe(200)
    await harness.drainOutbox()

    const moved = await get(`/s/${SITE}/architecture/rate-limits`)
    expect(moved.statusCode).toBe(301)
    expect(moved.headers['location']).toBe(`/s/${SITE}/architecture/throttling`)
    expect((await get(`/s/${SITE}/architecture/throttling`)).statusCode).toBe(200)
  })

  it('lists only the current path in the sitemap', async () => {
    const sitemap = (await get(`/s/${SITE}/sitemap.xml`)).body
    expect(sitemap).toContain('architecture/throttling')
    expect(sitemap).not.toContain('architecture/rate-limits')
  })

  it('answers the not-found page for an address that never existed', async () => {
    const response = await get(`/s/${SITE}/architecture/never-written`)
    expect(response.statusCode).toBe(404)
    expect(response.body).toContain('That page is not here')
  })
})

describe('the sitemap and robots.txt', () => {
  it('lists the site home and every current page, each with a lastmod', async () => {
    const response = await get(`/s/${SITE}/sitemap.xml`)
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/xml')
    expect(response.body).toContain('<urlset')
    expect(response.body).toContain(`<loc>${harness.deps.config.appUrl}/s/${SITE}</loc>`)
    expect(response.body).toContain(
      `<loc>${harness.deps.config.appUrl}/s/${SITE}/architecture/overview</loc>`,
    )
    expect(response.body).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/u)
  })

  it('has no draft anywhere in it', async () => {
    expect((await get(`/s/${SITE}/sitemap.xml`)).body).not.toContain('secret unpublished')
  })

  it('answers robots.txt with the rules and this site’s sitemap', async () => {
    const response = await get('/robots.txt')
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/plain')
    expect(response.body).toContain('Allow: /s/')
    expect(response.body).toContain('Disallow: /share/')
    expect(response.body).toContain(`Sitemap: ${harness.deps.config.appUrl}/s/${SITE}/sitemap.xml`)
  })
})

describe('the stylesheet', () => {
  it('is linked by hash, served immutable, and revalidates to 304', async () => {
    const href = stylesheetIn((await get(`/s/${SITE}`)).body)

    const css = await get(href)
    expect(css.statusCode).toBe(200)
    expect(css.headers['content-type']).toContain('text/css')
    expect(css.headers['cache-control']).toContain('immutable')
    expect(css.body).toContain('--palette-background')
    expect(css.body).toContain('.prose')
    expect(css.body).toContain('@media (prefers-color-scheme: dark)')

    const again = await get(href, { 'if-none-match': String(css.headers['etag']) })
    expect(again.statusCode).toBe(304)
  })

  it('refuses an asset name it did not mint', async () => {
    expect((await get('/s/_assets/theme-notahash.css')).statusCode).toBe(404)
    expect((await get(`/s/_assets/theme-${'0'.repeat(32)}.css`)).statusCode).toBe(404)
  })
})

describe('public search', () => {
  it('renders matches from this site, server-side', async () => {
    const response = await get(`/s/${SITE}/search?q=warehouses`)
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('1 result for')
    expect(response.body).toContain('href="/s/acme-docs/architecture/overview"')
    expect(response.body).toContain('<mark>')
  })

  it('returns nothing about a document the public may not see', async () => {
    const response = await get(`/s/${SITE}/search?q=Salaries`)
    expect(response.body).toContain('Nothing matched')
    expect(response.body).not.toContain('architecture/salaries')
  })

  it('shows an empty search page when nothing was asked for', async () => {
    const response = await get(`/s/${SITE}/search`)
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('<h1>Search</h1>')
  })

  it('escapes a query a stranger typed', async () => {
    const response = await get(`/s/${SITE}/search?q=%3Cscript%3Ealert(1)%3C/script%3E`)
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('<script>alert(1)')
  })

  it('answers a query the parser refuses without falling over', async () => {
    const response = await get(`/s/${SITE}/search?q=-onlyanexclusion`)
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Nothing matched')
  })
})

describe('a site that is not there', () => {
  it('answers 404 for a slug nobody publishes', async () => {
    expect((await get('/s/nobody')).statusCode).toBe(404)
    expect((await get('/s/nobody/a/b')).statusCode).toBe(404)
    expect((await get('/s/nobody/sitemap.xml')).statusCode).toBe(404)
    expect((await get('/s/nobody/search?q=x')).statusCode).toBe(404)
  })

  /**
   * Everything on this surface answers with HTML, including the misses: a
   * reader or a crawler meeting the platform's JSON error shape here would be
   * meeting the application, which is the one thing a public address must
   * never show (`docs/product/surfaces.md`).
   */
  it('answers in HTML, with no site name and nothing to index', async () => {
    const response = await get('/s/nobody')
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('<h1>Nothing is published here</h1>')
    expect(response.body).toContain('content="noindex,follow"')
    expect(response.body).not.toContain('Acme')
    expect(response.body).not.toContain('"error"')
  })

  it('disappears when the organisation stops allowing publishing, and comes back when it does', async () => {
    await allowPublishing(false)
    expect((await get(`/s/${SITE}`)).statusCode).toBe(404)
    expect((await get('/robots.txt')).body).not.toContain(`/s/${SITE}/sitemap.xml`)

    await allowPublishing(true)
    expect((await get(`/s/${SITE}`)).statusCode).toBe(200)
  })

  it('disappears when the site is unpublished, and keeps its address for when it returns', async () => {
    const unpublished = await harness.app.inject({
      method: 'DELETE',
      url: `/api/collections/${tenancy.collectionId}/public`,
      cookies: admin,
    })
    expect(unpublished.statusCode).toBe(200)
    expect(unpublished.json()).toMatchObject({ public: { enabled: false, siteSlug: SITE } })
    expect((await get(`/s/${SITE}`)).statusCode).toBe(404)

    expect((await publishSite(SITE)).statusCode).toBe(200)
    expect((await get(`/s/${SITE}`)).statusCode).toBe(200)
  })
})

describe('a second site in the same workspace', () => {
  let ops: CollectionId

  beforeAll(async () => {
    ops = await publishAnotherSite('Ops runbooks', 'acme-ops')
    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: editor,
      payload: { collectionId: ops, title: 'Failover' },
    })
    succeeded(created, 201)
    const id = created.json().document.id as DocumentId
    await writeDraft(id, '# Failover\n\nMoving widgets between warehouses, under duress.\n', 0)
    await publish(id, null)
    await harness.drainOutbox()
  }, 30_000)

  /**
   * The engine searches the workspace and the site is one collection of it, so
   * a page that is public *elsewhere* is a real hit that this site must not
   * offer — which is exactly what the page table is for.
   */
  it('keeps another site’s pages out of this site’s search results', async () => {
    const here = await get(`/s/${SITE}/search?q=warehouses`)
    expect(here.body).toContain('href="/s/acme-docs/architecture/overview"')
    expect(here.body).not.toContain('ops-runbooks/failover')

    const there = await get('/s/acme-ops/search?q=warehouses')
    expect(there.body).toContain('href="/s/acme-ops/ops-runbooks/failover"')
    expect(there.body).not.toContain('architecture/overview')
  })

  it('serves a site with nothing on it yet: an empty index and a sitemap of one address', async () => {
    await publishAnotherSite('Nothing here yet', 'acme-empty')
    const home = await get('/s/acme-empty')
    expect(home.statusCode).toBe(200)
    expect(home.body).toContain('Nothing has been published here yet.')
    expect(home.body).not.toContain('<nav class="site-nav"')

    const sitemap = await get('/s/acme-empty/sitemap.xml')
    expect(sitemap.statusCode).toBe(200)
    expect(sitemap.body).toContain(`<loc>${harness.deps.config.appUrl}/s/acme-empty</loc>`)
    expect(sitemap.body.match(/<url>/gu)).toHaveLength(1)
  })
})

/**
 * A settings file this release cannot read is what a downgrade leaves behind.
 * Every public surface treats it as "nothing is published", because no policy
 * can be applied without it — and the stylesheets this process already
 * generated keep serving, so a page a reader is holding does not lose its
 * styling as well. These run last and put the file back.
 */
describe('settings this release cannot read', () => {
  let before: string | null = null
  let stylesheetHref = ''

  beforeAll(async () => {
    stylesheetHref = stylesheetIn((await get(`/s/${SITE}`)).body)

    const current = await harness.deps.contentStore.readFile(
      SYSTEM_WORKSPACE_ID,
      ORGANISATION_SETTINGS_PATH,
    )
    before = current?.text ?? null
    await harness.deps.contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path: ORGANISATION_SETTINGS_PATH,
      text: `version: ${SETTINGS_VERSION + 1}\nname: From the future\n`,
      expected: before,
      author: { name: 'A newer release', email: 'future@example.com' },
    })
    // Planted behind the API, so nothing told the cache. In practice a
    // downgrade is a restart, which empties an in-process cache by existing;
    // here it is said out loud.
    harness.deps.publicSiteCache.invalidate()
  })

  afterAll(async () => {
    const current = await harness.deps.contentStore.readFile(
      SYSTEM_WORKSPACE_ID,
      ORGANISATION_SETTINGS_PATH,
    )
    await harness.deps.contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path: ORGANISATION_SETTINGS_PATH,
      text: before ?? '',
      expected: current?.text ?? null,
      author: { name: 'Restored', email: 'restore@example.com' },
    })
  })

  it('takes every site off the web, and names no sitemap in robots.txt', async () => {
    expect((await get(`/s/${SITE}`)).statusCode).toBe(404)
    expect((await get('/robots.txt')).body).not.toContain('Sitemap:')
  })

  it('keeps serving a stylesheet it has already generated', async () => {
    const css = await get(stylesheetHref)
    expect(css.statusCode).toBe(200)
    expect(css.body).toContain('--palette-background')
  })

  it('still refuses a stylesheet nobody asked it to generate', async () => {
    expect((await get(`/s/_assets/theme-${'1'.repeat(32)}.css`)).statusCode).toBe(404)
  })
})

describe('the pictures on a published page', () => {
  it('are served to a stranger, because a published page cannot lose them', async () => {
    const id = await createDocument('Illustrated')
    const boundary = 'publicsiteboundary'
    const bytes = Buffer.from(pngFile({ width: 3, height: 3 }))
    const uploaded = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/attachments`,
      cookies: editor,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="figure.png"\r\n` +
            'Content-Type: image/png\r\n\r\n',
          'utf8',
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
      ]),
    })
    succeeded(uploaded, 201)
    const url = uploaded.json().url as string

    await writeDraft(id, `# Illustrated\n\n![A figure](${url})\n`, 0)
    await publish(id, null)
    await harness.drainOutbox()

    // The page carries the picture's own URL, and the picture answers a
    // request with no cookies on it at all.
    const page = await get(`/s/${SITE}/architecture/illustrated`)
    expect(page.body).toContain(url)
    const picture = await get(url)
    expect(picture.statusCode).toBe(200)
    expect(picture.headers['content-type']).toBe('image/png')

    // And `robots.txt` lets a crawler fetch it, inside an otherwise closed API.
    const robots = (await get('/robots.txt')).body
    expect(robots).toContain('Allow: /api/attachments/')
  })
})

describe('what the site remembers between requests', () => {
  it('answers a second view without walking the collection again', async () => {
    const path = `/s/${SITE}/architecture/overview`
    const first = await get(path)
    expect(first.statusCode).toBe(200)

    // Change something the cache cannot see — a row, not an event — and the
    // held page is still served, which is the proof that it was held.
    await harness.deps.uow.repos.documents.update(
      overview,
      { title: 'Renamed behind it' },
      new Date(),
    )
    expect((await get(path)).body).toBe(first.body)

    // Past the time to live, the site is resolved again and the change lands.
    harness.clock.advance(PUBLIC_SITE_CACHE_TTL_MS)
    expect((await get(path)).statusCode).toBe(404)
    await harness.deps.uow.repos.documents.update(overview, { title: 'Overview' }, new Date())
    harness.deps.publicSiteCache.invalidate()
    expect((await get(path)).statusCode).toBe(200)
  })

  it('forgets a page when the document behind it is published again', async () => {
    const path = `/s/${SITE}/architecture/overview`
    expect((await get(path)).statusCode).toBe(200)

    const row = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${overview}`,
      cookies: editor,
    })
    succeeded(row)
    await writeDraft(overview, `${OVERVIEW_MARKDOWN}\n\nA newly published sentence.`, 1)
    succeeded(await publishFrom(overview, row.json().headRevision as string))
    await harness.drainOutbox()

    expect((await get(path)).body).toContain('A newly published sentence.')
  })

  it('forgets everything when the organisation’s settings change', async () => {
    const before = (await get(`/s/${SITE}`)).body
    await settings({ name: 'Acme Renamed' })
    const after = (await get(`/s/${SITE}`)).body
    expect(after).not.toBe(before)
    expect(after).toContain('Acme Renamed')
    await settings({ name: 'Acme' })
  })
})

describe('the budget in front of it', () => {
  it('refuses past it, and audits the key it counted', async () => {
    const small = await createServerHarness({
      rateLimit: { max: 2, windowMs: 1_000, maxWindowMs: 8_000 },
    })
    try {
      const asked = await Promise.all([
        small.app.inject({ method: 'GET', url: '/robots.txt' }),
        small.app.inject({ method: 'GET', url: '/robots.txt' }),
        small.app.inject({ method: 'GET', url: '/robots.txt' }),
      ])
      // The public budget is its own and far larger than the auth one, so the
      // three go through; what is proved here is that the route is *counted*.
      expect(asked.map((response) => response.statusCode)).toEqual([200, 200, 200])

      const exhausted = await Promise.all(
        Array.from({ length: small.deps.config.publicSiteRateLimitMax + 1 }, async () =>
          small.app.inject({ method: 'GET', url: '/robots.txt' }),
        ),
      )
      expect(exhausted.some((response) => response.statusCode === 429)).toBe(true)
      const refused = exhausted.find((response) => response.statusCode === 429)
      expect(refused?.json().error).toMatchObject({ code: 'rate_limited' })
    } finally {
      await small.close()
    }
  }, 60_000)
})

/**
 * A site with more addresses than one sitemap lists answers with an index of
 * sitemaps, which is what the protocol asks for and what stops one
 * unauthenticated request walking an unbounded number of documents. The page
 * size is shrunk rather than the corpus grown.
 */
describe('a site larger than one sitemap', () => {
  let paged: ServerHarness

  beforeAll(async () => {
    paged = await createServerHarness({ publicSitemapPageSize: 1 })
    const fixture = await seedTenancy(paged)
    const cookies = await paged.cookiesFor(fixture.admin)
    const editorCookies = await paged.cookiesFor(fixture.editor)

    const current = await paged.app.inject({
      method: 'GET',
      url: '/api/settings/organisation',
      cookies,
    })
    succeeded(
      await paged.app.inject({
        method: 'PUT',
        url: '/api/settings/organisation',
        cookies,
        payload: {
          settings: {
            ...current.json().settings,
            policies: {
              ...defaultOrganisationSettings().policies,
              publicPublishingAllowed: true,
            },
          },
          expectedRevision: current.json().revision,
        },
      }),
    )

    for (const title of ['Alpha', 'Beta']) {
      const created = await paged.app.inject({
        method: 'POST',
        url: `/api/workspaces/${fixture.workspaceId}/documents`,
        cookies: editorCookies,
        payload: { collectionId: fixture.collectionId, title },
      })
      succeeded(created, 201)
      const id = created.json().document.id as DocumentId
      const acquired = await paged.app.inject({
        method: 'POST',
        url: `/api/documents/${id}/lock/acquire`,
        cookies: editorCookies,
      })
      succeeded(acquired)
      const { frontMatter, ast } = parseDocument(`# ${title}\n\nA page.\n`)
      succeeded(
        await paged.app.inject({
          method: 'PUT',
          url: `/api/documents/${id}/draft`,
          cookies: editorCookies,
          payload: { ast: { version: 1, frontMatter, ast }, expectedVersion: 0 },
        }),
      )
      await paged.app.inject({
        method: 'DELETE',
        url: `/api/documents/${id}/lock`,
        cookies: editorCookies,
      })
      succeeded(
        await paged.app.inject({
          method: 'POST',
          url: `/api/documents/${id}/publish`,
          cookies: editorCookies,
          payload: { base: null },
        }),
      )
    }
    await paged.drainOutbox()
    succeeded(
      await paged.app.inject({
        method: 'POST',
        url: `/api/collections/${fixture.collectionId}/public`,
        cookies,
        payload: { siteSlug: 'big-docs' },
      }),
    )
  }, 60_000)

  afterAll(async () => {
    await paged.close()
  })

  const fetchFrom = (url: string) => paged.app.inject({ method: 'GET', url })

  it('answers with an index of sitemaps, and serves each page of it', async () => {
    const index = await fetchFrom('/s/big-docs/sitemap.xml')
    expect(index.statusCode).toBe(200)
    expect(index.body).toContain('<sitemapindex')
    expect(index.body).toContain('/s/big-docs/sitemap/1')
    expect(index.body).toContain('/s/big-docs/sitemap/2')

    const first = await fetchFrom('/s/big-docs/sitemap/1')
    expect(first.statusCode).toBe(200)
    expect(first.body).toContain('<urlset')
    // The site's own address is on the first page and nowhere else.
    expect(first.body).toContain('<loc>http://localhost:3000/s/big-docs</loc>')

    const second = await fetchFrom('/s/big-docs/sitemap/2')
    expect(second.statusCode).toBe(200)
    expect(second.body).not.toContain('<loc>http://localhost:3000/s/big-docs</loc>')
    expect(first.body).not.toBe(second.body)
  })

  it('refuses a page number that is not one', async () => {
    expect((await fetchFrom('/s/big-docs/sitemap/0')).statusCode).toBe(404)
    expect((await fetchFrom('/s/big-docs/sitemap/nonsense')).statusCode).toBe(404)
  })

  it('answers the site-less page for a sitemap page of a site that is not there', async () => {
    const response = await fetchFrom('/s/nobody/sitemap/1')
    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('text/html')
  })
})
