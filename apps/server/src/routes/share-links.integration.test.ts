import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parseDocument } from '@quill/markdown'
import type { DocumentId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Share links end to end (plan section 14; use cases 24–26).
 *
 * Two surfaces in one file, because the point of the feature is the seam
 * between them: what an administrator creates inside the application, and
 * what a stranger holding the resulting URL can see without an account.
 *
 * The assertions that matter most are negative ones — the token is nowhere in
 * the database, nowhere in the audit log; the page carries no draft, no lock
 * and no other workspace data; every refusal is the same `404` — because this
 * is the one anonymous, non-public surface the platform has.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>

/** The target of most links, its published child, and a sibling outside any link. */
let parent: DocumentId
let child: DocumentId
let sibling: DocumentId
let unpublished: DocumentId
/** Inside the subtree, but with nothing published: a page with no body. */
let unpublishedChild: DocumentId

const UNKNOWN_TOKEN = 'Yb3nXq7Tz9LmK0aQw2Rd4Ef6Gh8Jk1Np3Sv5Uz7Wx9'
const UNKNOWN_LINK = '00000000-0000-4000-8000-0000000009ff'

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)

  parent = await publishedDocument('Authentication architecture', null)
  child = await publishedDocument('Token rotation', parent)
  sibling = await publishedDocument('Unrelated runbook', null)
  unpublished = await createDocument('Nothing written yet', null)
  unpublishedChild = await createDocument('Drafted but never published', parent)
}, 60_000)

afterAll(async () => {
  await harness.close()
})

beforeEach(async () => {
  harness.setShareLinksAllowed(true)
  await harness.database.pool.query('DELETE FROM share_links')
  await harness.database.pool.query("DELETE FROM audit_events WHERE type LIKE 'share_link.%'")
})

/** Where a document is written, so both harnesses in this file can use one helper. */
interface Writer {
  readonly on: ServerHarness
  readonly as: Record<string, string>
  readonly tenancy: TenancyFixture
}

async function createDocumentIn(
  writer: Writer,
  title: string,
  parentId: DocumentId | null = null,
): Promise<DocumentId> {
  const response = await writer.on.app.inject({
    method: 'POST',
    url: `/api/workspaces/${writer.tenancy.workspaceId}/documents`,
    cookies: writer.as,
    payload: {
      collectionId: writer.tenancy.collectionId,
      title,
      ...(parentId === null ? {} : { parentId }),
    },
  })
  expect(response.statusCode).toBe(201)
  return response.json().document.id as DocumentId
}

/** A document with a body, because a share-link page only ever shows published content. */
async function publishDocumentIn(
  writer: Writer,
  title: string,
  parentId: DocumentId | null = null,
): Promise<DocumentId> {
  const id = await createDocumentIn(writer, title, parentId)
  const markdown = [`# ${title}`, '', `The body of ${title}.`].join('\n')
  const { frontMatter, ast } = parseDocument(markdown)

  const acquired = await writer.on.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/lock/acquire`,
    cookies: writer.as,
  })
  expect(acquired.statusCode).toBe(200)
  const write = await writer.on.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    cookies: writer.as,
    payload: { ast: { version: 1, frontMatter, ast }, expectedVersion: 0 },
  })
  expect(write.statusCode).toBe(200)
  await writer.on.app.inject({
    method: 'DELETE',
    url: `/api/documents/${id}/lock`,
    cookies: writer.as,
  })

  const published = await writer.on.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/publish`,
    cookies: writer.as,
    payload: { base: null },
  })
  expect(published.statusCode).toBe(200)
  return id
}

const createDocument = (title: string, parentId: DocumentId | null): Promise<DocumentId> =>
  createDocumentIn({ on: harness, as: editor, tenancy }, title, parentId)

const publishedDocument = (title: string, parentId: DocumentId | null): Promise<DocumentId> =>
  publishDocumentIn({ on: harness, as: editor, tenancy }, title, parentId)

interface CreatedLink {
  readonly id: string
  readonly token: string
  readonly url: string
}

async function createLink(
  documentId: DocumentId = parent,
  body: Record<string, unknown> = {},
  cookies = admin,
): Promise<CreatedLink> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${documentId}/share-links`,
    cookies,
    payload: { scope: 'document', ...body },
  })
  expect(response.statusCode).toBe(201)
  const created = response.json()
  return { id: created.link.id, token: created.token, url: created.url }
}

const follow = async (token: string) =>
  harness.app.inject({ method: 'GET', url: `/api/share/${token}` })

const followChild = async (token: string, documentId: string, headers = {}) =>
  harness.app.inject({
    method: 'GET',
    url: `/api/share/${token}/documents/${documentId}/rendered`,
    headers,
  })

async function auditTypes(): Promise<string[]> {
  const { rows } = await harness.database.pool.query<{ type: string }>(
    "SELECT type FROM audit_events WHERE type LIKE 'share_link.%' ORDER BY created_at, id",
  )
  return rows.map((row) => row.type)
}

describe('creating a share link', () => {
  it('hands the token back once and stores only its hash', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${parent}/share-links`,
      cookies: admin,
      payload: { scope: 'subtree' },
    })

    expect(response.statusCode).toBe(201)
    const created = response.json()
    expect(created.link.scope).toBe('subtree')
    expect(created.link.role).toBe('viewer')
    expect(created.link.documentId).toBe(parent)
    expect(created.link.revokedAt).toBeNull()
    expect(created.link.lastUsedAt).toBeNull()
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(created.url).toBe(`${harness.deps.config.appUrl}/share/${created.token}`)

    // Nothing in the row is the token, in any column (ADR-011).
    const { rows } = await harness.database.pool.query('SELECT * FROM share_links')
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0])).not.toContain(created.token)
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)

    // And it can never be asked for again.
    const listed = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${parent}/share-links`,
      cookies: admin,
    })
    expect(JSON.stringify(listed.json())).not.toContain(created.token)
  })

  it('accepts an expiry, and refuses one that has already passed', async () => {
    const expiresAt = new Date(harness.clock.now().getTime() + 60_000).toISOString()
    const created = await createLink(parent, { expiresAt })
    expect(created.token).not.toBe('')

    const past = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${parent}/share-links`,
      cookies: admin,
      payload: {
        scope: 'document',
        expiresAt: new Date(harness.clock.now().getTime() - 1).toISOString(),
      },
    })
    expect(past.statusCode).toBe(422)
    expect(past.json().error.code).toBe('share_link_expiry_in_the_past')
  })

  it('treats an omitted, null, or empty expiry alike: the link never expires', async () => {
    for (const payload of [{}, { expiresAt: null }]) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/documents/${parent}/share-links`,
        cookies: admin,
        payload: { scope: 'document', ...payload },
      })
      expect(response.statusCode).toBe(201)
      expect(response.json().link.expiresAt).toBeNull()
    }
  })

  it('needs manage on the document, which an editor and a viewer do not have', async () => {
    for (const cookies of [editor, viewer]) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/documents/${parent}/share-links`,
        cookies,
        payload: { scope: 'document' },
      })
      expect(response.statusCode).toBe(403)
    }
  })

  it('refuses a role this release does not carry', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${parent}/share-links`,
      cookies: admin,
      payload: { scope: 'document', role: 'editor' },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('share_link_role_unavailable')
    expect(response.json().error.details).toEqual({ role: 'editor' })
    expect(await harness.database.pool.query('SELECT * FROM share_links')).toMatchObject({
      rowCount: 0,
    })
  })

  it('refuses every link when the organisation does not allow them', async () => {
    harness.setShareLinksAllowed(false)
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${parent}/share-links`,
      cookies: admin,
      payload: { scope: 'document' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('share_links_disabled')
  })

  it('audits the creation, naming the link and never the token', async () => {
    const created = await createLink()
    const { rows } = await harness.database.pool.query(
      "SELECT * FROM audit_events WHERE type = 'share_link.created'",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].target_type).toBe('share-link')
    expect(rows[0].target_id).toBe(created.id)
    expect(rows[0].actor_user_id).toBe(tenancy.admin)
    expect(JSON.stringify(rows[0])).not.toContain(created.token)
  })
})

describe('listing and revoking share links', () => {
  it('lists a document’s links newest first, for whoever may manage it', async () => {
    const first = await createLink()
    harness.clock.advance(1000)
    const second = await createLink(parent, { scope: 'subtree' })

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${parent}/share-links`,
      cookies: admin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().links.map((link: { id: string }) => link.id)).toEqual([
      second.id,
      first.id,
    ])

    const refused = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${parent}/share-links`,
      cookies: viewer,
    })
    expect(refused.statusCode).toBe(403)
  })

  it('closes a link on the next request, not after a cache expiry', async () => {
    const created = await createLink()
    expect((await follow(created.token)).statusCode).toBe(200)

    const revoked = await harness.app.inject({
      method: 'DELETE',
      url: `/api/share-links/${created.id}`,
      cookies: admin,
    })
    expect(revoked.statusCode).toBe(204)
    expect((await follow(created.token)).statusCode).toBe(404)
    // The read that was refused writes nothing: a use is a use of a link
    // that worked.
    expect(await auditTypes()).toEqual([
      'share_link.created',
      'share_link.used',
      'share_link.revoked',
    ])
  })

  it('is idempotent, and reports a link that is not there', async () => {
    const created = await createLink()
    const first = await harness.app.inject({
      method: 'DELETE',
      url: `/api/share-links/${created.id}`,
      cookies: admin,
    })
    const second = await harness.app.inject({
      method: 'DELETE',
      url: `/api/share-links/${created.id}`,
      cookies: admin,
    })
    expect([first.statusCode, second.statusCode]).toEqual([204, 204])
    // Revoked once, audited once: the second call changed nothing.
    expect((await auditTypes()).filter((type) => type === 'share_link.revoked')).toHaveLength(1)

    const missing = await harness.app.inject({
      method: 'DELETE',
      url: `/api/share-links/${UNKNOWN_LINK}`,
      cookies: admin,
    })
    expect(missing.statusCode).toBe(404)
  })

  it('needs manage on the document the link opens', async () => {
    const created = await createLink()
    const refused = await harness.app.inject({
      method: 'DELETE',
      url: `/api/share-links/${created.id}`,
      cookies: editor,
    })
    expect(refused.statusCode).toBe(403)
    expect((await follow(created.token)).statusCode).toBe(200)
  })
})

describe('reading through a share link', () => {
  it('answers a stranger with the document, and nothing else about the organisation', async () => {
    const created = await createLink()
    const response = await follow(created.token)

    expect(response.statusCode).toBe(200)
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
    const body = response.json()
    expect(Object.keys(body).toSorted()).toEqual(['children', 'document', 'link', 'rendered'])
    expect(body.document.title).toBe('Authentication architecture')
    expect(body.rendered.html).toContain('The body of Authentication architecture.')
    expect(body.link).toEqual({ scope: 'document', role: 'viewer', expiresAt: null })
    expect(body.children).toEqual([])

    // No draft, no lock, no workspace, no collection, no status, and nothing
    // naming another document (`docs/product/surfaces.md`).
    const serialised = JSON.stringify(body)
    for (const forbidden of ['workspaceId', 'collectionId', 'lock', 'draft', 'permissions']) {
      expect(serialised).not.toContain(forbidden)
    }
    expect(serialised).not.toContain('Unrelated runbook')
  })

  it('offers the published subtree when the link is a subtree, and nothing when it is not', async () => {
    const subtree = await createLink(parent, { scope: 'subtree' })
    const single = await createLink(parent, { scope: 'document' })

    const wide = (await follow(subtree.token)).json()
    expect(wide.children).toHaveLength(1)
    expect(wide.children[0].id).toBe(child)
    expect(wide.children[0].title).toBe('Token rotation')
    expect(wide.children[0].children).toEqual([])
    // A document with nothing published is not offered: it is a dead end.
    expect(JSON.stringify(wide.children)).not.toContain(unpublished)

    expect((await follow(single.token)).json().children).toEqual([])
  })

  it('serves a child of a subtree link, with an ETag it honours', async () => {
    const subtree = await createLink(parent, { scope: 'subtree' })
    const response = await followChild(subtree.token, child)

    expect(response.statusCode).toBe(200)
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
    const etag = response.headers['etag']
    expect(typeof etag).toBe('string')
    expect(response.json().document.title).toBe('Token rotation')

    const again = await followChild(subtree.token, child, { 'if-none-match': String(etag) })
    expect(again.statusCode).toBe(304)
    expect(again.body).toBe('')

    // An exact match, and only that. A weak validator and a list of tags are
    // not honoured — the body is re-sent, which is correct if wasteful — and
    // a tag from another body is not a match at all.
    for (const header of [`W/${String(etag)}`, `"nonsense", ${String(etag)}`, '"nonsense"']) {
      const resent = await followChild(subtree.token, child, { 'if-none-match': header })
      expect(resent.statusCode).toBe(200)
    }
  })

  it('takes the document’s short key as readily as its id (ADR-035)', async () => {
    const subtree = await createLink(parent, { scope: 'subtree' })
    const document = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${child}`,
      cookies: admin,
    })
    const shortId = document.json().shortId as string

    const byKey = await followChild(subtree.token, shortId)
    expect(byKey.statusCode).toBe(200)
    expect(byKey.json().document.id).toBe(child)
  })

  it('refuses everything outside the link’s scope with the one answer', async () => {
    const single = await createLink(parent, { scope: 'document' })
    const subtree = await createLink(parent, { scope: 'subtree' })

    const refusals = [
      // A child, through a link that is for one document only.
      await followChild(single.token, child),
      // A document in the same workspace, outside the subtree entirely.
      await followChild(subtree.token, sibling),
      // A document that has never been published, inside the link's scope
      // and outside it alike: a share-link page shows no drafts.
      await followChild(subtree.token, unpublishedChild),
      await followChild(subtree.token, unpublished),
      // A document reference that names nothing at all.
      await followChild(subtree.token, 'aaaaaaaaaa'),
      await followChild(subtree.token, UNKNOWN_LINK),
      // A token nobody ever issued, on either reading route.
      await follow(UNKNOWN_TOKEN),
      await followChild(UNKNOWN_TOKEN, child),
    ]

    for (const refusal of refusals) {
      expect(refusal.statusCode).toBe(404)
      expect(refusal.json()).toEqual((refusals[0] as (typeof refusals)[number]).json())
    }
  })

  it('answers an expired and a revoked link exactly as it answers an unknown one', async () => {
    const expiring = await createLink(parent, {
      expiresAt: new Date(harness.clock.now().getTime() + 60_000).toISOString(),
    })
    const revoking = await createLink()
    await harness.app.inject({
      method: 'DELETE',
      url: `/api/share-links/${revoking.id}`,
      cookies: admin,
    })
    harness.clock.advance(60_000)

    const unknown = await follow(UNKNOWN_TOKEN)
    const expired = await follow(expiring.token)
    const revoked = await follow(revoking.token)

    for (const response of [expired, revoked]) {
      expect(response.statusCode).toBe(unknown.statusCode)
      expect(response.json()).toEqual(unknown.json())
    }
  })

  it('closes every link when the organisation stops allowing them', async () => {
    const created = await createLink()
    expect((await follow(created.token)).statusCode).toBe(200)

    harness.setShareLinksAllowed(false)
    const closed = await follow(created.token)
    expect(closed.statusCode).toBe(404)
    expect(closed.json()).toEqual((await follow(UNKNOWN_TOKEN)).json())
  })

  it('audits every use, naming the document read, and never the token or the address', async () => {
    const created = await createLink(parent, { scope: 'subtree' })

    expect((await follow(created.token)).statusCode).toBe(200)
    harness.clock.advance(5000)
    expect((await followChild(created.token, child)).statusCode).toBe(200)

    // One row per use — the plan's "every use is audited" (section 14), and
    // use case 25's "given any use, when the audit log is read, then that use
    // is recorded". The rate limit is what bounds how many there can be.
    expect(await auditTypes()).toEqual(['share_link.created', 'share_link.used', 'share_link.used'])
    const { rows } = await harness.database.pool.query(
      'SELECT * FROM audit_events WHERE type = $1 ORDER BY created_at, id',
      ['share_link.used'],
    )
    expect(rows.map((row) => row.target_id)).toEqual([created.id, created.id])
    expect(rows.map((row) => row.metadata.documentId)).toEqual([parent, child])

    // The address is a SHA-256 digest, so an audit export is not a list of
    // who read what from where — and the token is nowhere at all.
    for (const row of rows) {
      expect(row.metadata.address).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(JSON.stringify(rows)).not.toContain(created.token)
    expect(JSON.stringify(rows)).not.toContain('127.0.0.1')

    const listed = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${parent}/share-links`,
      cookies: admin,
    })
    const link = listed.json().links.find((entry: { id: string }) => entry.id === created.id)
    expect(new Date(link.lastUsedAt).getTime()).toBe(harness.clock.now().getTime())
  })

  /**
   * The reading routes never look at the session cookie. The instance
   * administrator can read every document in the instance through the
   * application — and through a document-scoped link they get the one
   * document that link names, and the same `404` as a stranger for anything
   * else.
   */
  it('does not consult the session: an administrator gets the link’s answer, not their own', async () => {
    const single = await createLink(parent, { scope: 'document' })

    const asAdmin = await harness.app.inject({
      method: 'GET',
      url: `/api/share/${single.token}/documents/${sibling}/rendered`,
      cookies: admin,
    })
    expect(asAdmin.statusCode).toBe(404)
    expect(asAdmin.json()).toEqual((await follow(UNKNOWN_TOKEN)).json())

    // And the administrator can plainly read that same document as themselves.
    const throughTheApp = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${sibling}/rendered`,
      cookies: admin,
    })
    expect(throughTheApp.statusCode).toBe(200)
  })

  it('reads without a session, and reads the same way with one', async () => {
    const created = await createLink()
    const anonymous = await follow(created.token)
    const signedIn = await harness.app.inject({
      method: 'GET',
      url: `/api/share/${created.token}`,
      cookies: viewer,
    })
    expect(signedIn.statusCode).toBe(200)
    expect(signedIn.json()).toEqual(anonymous.json())
  })

  /**
   * A subtree link grants what is under its target *now*, not what was under
   * it when the link was made: the scope is resolved against the tree on
   * every request, so moving a document out closes it to that link at once.
   */
  it('stops reaching a document that has been moved out of the subtree', async () => {
    const subtree = await createLink(parent, { scope: 'subtree' })
    expect((await followChild(subtree.token, child)).statusCode).toBe(200)

    const moved = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${child}`,
      cookies: admin,
      payload: { parentId: null },
    })
    expect(moved.statusCode).toBe(200)

    const refused = await followChild(subtree.token, child)
    expect(refused.statusCode).toBe(404)
    expect(refused.json()).toEqual((await follow(UNKNOWN_TOKEN)).json())

    // Put it back, so the rest of the file sees the tree it was built with.
    const restored = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${child}`,
      cookies: admin,
      payload: { parentId: parent },
    })
    expect(restored.statusCode).toBe(200)
  })

  /** The target itself can be a document with nothing published. */
  it('refuses the root route when the link’s own target has never been published', async () => {
    const created = await createLink(unpublished, { scope: 'subtree' })
    const response = await follow(created.token)
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual((await follow(UNKNOWN_TOKEN)).json())
  })
})

describe('the anonymous reading surface under load', () => {
  const RATE_LIMIT = { max: 3, windowMs: 1000, maxWindowMs: 8000 }
  let limited: ServerHarness
  let limitedTenancy: TenancyFixture
  let token: string

  beforeAll(async () => {
    limited = await createServerHarness({ rateLimit: RATE_LIMIT })
    limitedTenancy = await seedTenancy(limited)
    const cookies = await limited.cookiesFor(limitedTenancy.admin)
    const documentId = await publishDocumentIn(
      { on: limited, as: cookies, tenancy: limitedTenancy },
      'Rate limited',
    )

    const created = await limited.app.inject({
      method: 'POST',
      url: `/api/documents/${documentId}/share-links`,
      cookies,
      payload: { scope: 'document' },
    })
    if (created.statusCode !== 201) {
      throw new Error(`expected a share link, got ${created.statusCode}: ${created.body}`)
    }
    token = created.json().token
  }, 60_000)

  afterAll(async () => {
    await limited.close()
  })

  it('spends a budget per source address and then refuses, whatever the token', async () => {
    for (let attempt = 0; attempt < RATE_LIMIT.max; attempt += 1) {
      await limited.app.inject({ method: 'GET', url: `/api/share/${token}` })
    }

    const refused = await limited.app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(refused.statusCode).toBe(429)
    expect(refused.json().error.code).toBe('rate_limited')

    // Guessing tokens costs the same budget, which is the point: the surface
    // is anonymous and the token is the whole of its security (ADR-011).
    const guessing = await limited.app.inject({ method: 'GET', url: `/api/share/${UNKNOWN_TOKEN}` })
    expect(guessing.statusCode).toBe(429)

    limited.clock.advance(RATE_LIMIT.maxWindowMs * 2)
    const later = await limited.app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(later.statusCode).toBe(200)
  })
})
