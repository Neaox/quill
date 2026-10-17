import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGrant, defaultOrganisationSettings } from '@quill/application'
import type { OrganisationSettings } from '@quill/application'
import { parseDocument } from '@quill/markdown'
import type { CollectionId, DocumentId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Links from one document to another, on the two surfaces outside the
 * application (ADR-035, ADR-046, ADR-023).
 *
 * A body stores a link to another document as `/d/<id>`, which only the
 * signed-in application can open. The public site and a share link each
 * readdress the links to documents they show, and reduce every other one to
 * its words: a stranger must never be handed the id, the workspace or the
 * title of a page they were not shown, and must never be handed a link into
 * an application they cannot sign in to.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let admin: Record<string, string>

const SITE = 'links-site'

/** The page whose links are under test, and every kind of page it links to. */
let linker: DocumentId
let target: DocumentId
let targetShortId: string
let draft: DocumentId
let carved: DocumentId
let elsewhere: DocumentId
let workspaceSlug: string

async function createDocument(
  title: string,
  options: { parentId?: DocumentId; collectionId?: CollectionId } = {},
): Promise<{ id: DocumentId; shortId: string }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: {
      collectionId: options.collectionId ?? tenancy.collectionId,
      title,
      ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
    },
  })
  expect(response.statusCode).toBe(201)
  const { document } = response.json() as { document: { id: DocumentId; shortId: string } }
  return document
}

async function writeAndPublish(id: DocumentId, markdown: string): Promise<void> {
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

/** A fixture step that must have worked, stated where a hook can say so. */
function succeeded(response: { statusCode: number }, status = 200): void {
  expect(response.statusCode).toBe(status)
}

async function createShareLink(scope: 'document' | 'subtree'): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${linker}/share-links`,
    cookies: admin,
    payload: { scope },
  })
  expect(response.statusCode).toBe(201)
  return (response.json() as { token: string }).token
}

const LINKER_MARKDOWN = (ids: {
  target: DocumentId
  pasted: string
  draft: DocumentId
  carved: DocumentId
  elsewhere: DocumentId
  absolute: string
}) =>
  [
    '# Start here',
    '',
    `Read [the setup guide](/d/${ids.target}#user-content-install) first.`,
    '',
    `Or [the pasted address](${ids.pasted}).`,
    '',
    `Not [the unwritten plan](/d/${ids.draft}) yet.`,
    '',
    `Never [the carved-out page](/d/${ids.carved}).`,
    '',
    `Nor [the other collection](/d/${ids.elsewhere}).`,
    '',
    `Back to [this page](/d/LINKER_SELF#user-content-start-here).`,
    '',
    `Also [the copied address](${ids.absolute}#user-content-install).`,
    '',
    'And [the web](https://example.com/guide).',
  ].join('\n')

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  editor = await harness.cookiesFor(tenancy.editor)
  admin = await harness.cookiesFor(tenancy.admin)
  harness.setShareLinksAllowed(true)
  await settings({
    policies: { ...defaultOrganisationSettings().policies, publicPublishingAllowed: true },
  })

  const workspace = await harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${tenancy.workspaceId}`,
    cookies: editor,
  })
  workspaceSlug = (workspace.json() as { slug: string }).slug

  const other = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/collections`,
    cookies: admin,
    payload: { name: 'Internal notes' },
  })
  succeeded(other, 201)
  const otherCollection = (other.json() as { id: CollectionId }).id

  const linkerRow = await createDocument('Start here')
  linker = linkerRow.id
  const targetRow = await createDocument('Setup guide', { parentId: linker })
  target = targetRow.id
  targetShortId = targetRow.shortId
  draft = (await createDocument('Secret unwritten plan', { parentId: linker })).id
  carved = (await createDocument('Carved salaries', { parentId: linker })).id
  elsewhere = (await createDocument('Internal roadmap', { collectionId: otherCollection })).id

  await writeAndPublish(target, ['# Setup guide', '', '## Install', '', 'Run it.'].join('\n'))
  await writeAndPublish(carved, ['# Carved salaries', '', 'Not for the web.'].join('\n'))
  await writeAndPublish(elsewhere, ['# Internal roadmap', '', 'Not on this site.'].join('\n'))
  await writeAndPublish(
    linker,
    LINKER_MARKDOWN({
      target,
      pasted: `/w/${workspaceSlug}/d/setup-guide-${targetShortId}`,
      draft,
      carved,
      elsewhere,
      absolute: `${harness.deps.config.appOrigin}/w/${workspaceSlug}/d/setup-guide-${targetShortId}`,
    }).replace('LINKER_SELF', linker),
  )
  await harness.drainOutbox()

  const denied = await createGrant(harness.deps, {
    principalKind: 'public',
    principalId: null,
    scopeKind: 'document',
    scopeId: carved,
    role: 'viewer',
    effect: 'deny',
    createdBy: tenancy.admin,
  })
  succeeded({ statusCode: denied.kind === 'created' ? 200 : 500 })

  const site = await harness.app.inject({
    method: 'POST',
    url: `/api/collections/${tenancy.collectionId}/public`,
    cookies: admin,
    payload: { siteSlug: SITE, homeDocumentId: linker },
  })
  succeeded(site)
  harness.deps.publicSiteCache.invalidate()
}, 60_000)

afterAll(async () => {
  await harness.close()
})

/** Everything a body must not carry about the pages its reader was not shown. */
function expectNothingLeaked(html: string): void {
  for (const secret of [draft, carved, elsewhere, workspaceSlug, 'Secret unwritten plan']) {
    expect(html).not.toContain(secret)
  }
  expect(html).not.toMatch(/href="\/(?:d|w)\//u)
}

describe('links on the public site', () => {
  async function page(): Promise<string> {
    const response = await harness.app.inject({ method: 'GET', url: `/s/${SITE}` })
    expect(response.statusCode).toBe(200)
    return response.body
  }

  it('sends a link to a page on the same site to its address there, keeping the section', async () => {
    const html = await page()

    expect(html).toMatch(
      /<a href="\/s\/links-site\/[^"]*setup-guide#user-content-install">the setup guide<\/a>/u,
    )
  })

  it('resolves an address pasted from the application by its key', async () => {
    expect(await page()).toMatch(
      /<a href="\/s\/links-site\/[^"]*setup-guide">the pasted address<\/a>/u,
    )
  })

  it('links a page to itself at its own address', async () => {
    expect(await page()).toMatch(
      /<a href="\/s\/links-site\/[^"]*start-here#user-content-start-here">this page<\/a>/u,
    )
  })

  it('reduces links to an unpublished, a carved-out and an off-site page to their words', async () => {
    const html = await page()

    expect(html).toContain('Not the unwritten plan yet.')
    expect(html).toContain('Never the carved-out page.')
    expect(html).toContain('Nor the other collection.')
    expectNothingLeaked(html)
  })

  it('treats an absolute address of this application, copied from the address bar, as its own', async () => {
    const html = await page()

    expect(html).toMatch(
      /<a href="\/s\/links-site\/[^"]*setup-guide#user-content-install">the copied address<\/a>/u,
    )
    expect(html).not.toContain(`href="${harness.deps.config.appOrigin}/w/`)
  })

  it('leaves a link to the web exactly as written', async () => {
    expect(await page()).toContain('href="https://example.com/guide"')
  })
})

describe('links on a share-link page', () => {
  it('sends a link inside a subtree link to the page under the same token, and the rest to words', async () => {
    const token = await createShareLink('subtree')
    const response = await harness.app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(response.statusCode).toBe(200)
    const { html } = (response.json() as { rendered: { html: string } }).rendered

    expect(html).toContain(
      `<a href="/share/${token}/d/setup-guide-${targetShortId}#user-content-install">the setup guide</a>`,
    )
    expect(html).toContain(
      `<a href="/share/${token}/d/setup-guide-${targetShortId}">the pasted address</a>`,
    )
    expect(html).toContain(`<a href="/share/${token}#user-content-start-here">this page</a>`)
    expect(html).toContain('Not the unwritten plan yet.')
    expect(html).toContain('Nor the other collection.')
    expect(html).not.toContain(draft)
    expect(html).not.toContain(elsewhere)
    expect(html).not.toMatch(/href="\/(?:d|w)\//u)
  })

  it('links back to the shared page from a page under it', async () => {
    const token = await createShareLink('subtree')
    await writeLinkBack()
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/share/${token}/documents/${target}/rendered`,
    })
    expect(response.statusCode).toBe(200)
    const { html } = (response.json() as { rendered: { html: string } }).rendered

    expect(html).toContain(`<a href="/share/${token}">the start</a>`)
  })

  it('reduces every other page to words on a link to one document', async () => {
    const token = await createShareLink('document')
    const response = await harness.app.inject({ method: 'GET', url: `/api/share/${token}` })
    const { html } = (response.json() as { rendered: { html: string } }).rendered

    expect(html).toContain('Read the setup guide first.')
    expect(html).toContain(`<a href="/share/${token}#user-content-start-here">this page</a>`)
    expect(html).not.toContain(target)
    expect(html).not.toMatch(/href="\/(?:d|w)\//u)
  })
})

/** Gives the setup guide a link back to the page it sits under, once. */
let linkedBack = false
async function writeLinkBack(): Promise<void> {
  if (linkedBack) return
  linkedBack = true
  const row = await harness.app.inject({
    method: 'GET',
    url: `/api/documents/${target}`,
    cookies: editor,
  })
  const acquired = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${target}/lock/acquire`,
    cookies: editor,
  })
  expect(acquired.statusCode).toBe(200)
  const { frontMatter, ast } = parseDocument(
    ['# Setup guide', '', '## Install', '', `Run it, then see [the start](/d/${linker}).`].join(
      '\n',
    ),
  )
  const write = await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${target}/draft`,
    cookies: editor,
    payload: { ast: { version: 1, frontMatter, ast }, expectedVersion: 1 },
  })
  expect(write.statusCode).toBe(200)
  await harness.app.inject({
    method: 'DELETE',
    url: `/api/documents/${target}/lock`,
    cookies: editor,
  })
  const published = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${target}/publish`,
    cookies: editor,
    payload: { base: (row.json() as { headRevision: string }).headRevision },
  })
  expect(published.statusCode).toBe(200)
}

describe('readable addresses for the links in a body (POST /api/documents/links)', () => {
  async function resolve(cookies: Record<string, string>, references: readonly string[]) {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/documents/links',
      cookies,
      payload: { references },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-cache')
    return (response.json() as { links: { reference: string; href: string }[] }).links
  }

  it('answers each reference a reader may open with its reading address, in one request', async () => {
    const links = await resolve(editor, [target, targetShortId, `old-words-${targetShortId}`])

    const href = `/w/${workspaceSlug}/d/setup-guide-${targetShortId}`
    expect(links).toEqual([
      { reference: target, href },
      { reference: targetShortId, href },
      { reference: `old-words-${targetShortId}`, href },
    ])
  })

  it('leaves out what names nothing, and what the reader may not open, saying nothing about it', async () => {
    const outsider = await harness.cookiesFor(tenancy.outsider)

    // The same two, which a member of the workspace may open.
    expect(await resolve(editor, [elsewhere, carved])).toHaveLength(2)
    expect(await resolve(outsider, [elsewhere, carved])).toEqual([])
    expect(
      await resolve(editor, ['not-a-reference', '00000000-0000-4000-8000-0000000000ff']),
    ).toEqual([])
  })

  it('refuses a request without a session, and a batch past its bound', async () => {
    const anonymous = await harness.app.inject({
      method: 'POST',
      url: '/api/documents/links',
      payload: { references: [target] },
    })
    expect(anonymous.statusCode).toBe(401)

    const tooMany = await harness.app.inject({
      method: 'POST',
      url: '/api/documents/links',
      cookies: editor,
      payload: { references: Array.from({ length: 201 }, () => target) },
    })
    expect(tooMany.statusCode).toBe(400)
  })
})
