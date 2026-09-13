import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId } from '@quill/domain'
import type { ShareLinkId } from '@quill/domain'

import {
  aShortId,
  createFakeClock,
  createFakeIdGenerator,
  createFakeTokenService,
} from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { ShareLinkDependencies } from './share-links.ts'
import {
  SHARE_LINK_AUDIT_EVENTS,
  createShareLink,
  listShareLinks,
  recordShareLinkUse,
  resolveShareLink,
  revokeShareLink,
  shareLinkNavigation,
  toShareLink,
} from './share-links.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const HOUR = 60 * 60 * 1000

const AUTHOR = userId('00000000-0000-4000-8000-000000000001')
const DOCUMENT = documentId('00000000-0000-4000-8000-000000000201')
const CHILD = documentId('00000000-0000-4000-8000-000000000202')

let uow: InMemoryUnitOfWork
let clock: FakeClock
let linksAllowed: boolean
let deps: ShareLinkDependencies

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  clock = createFakeClock(NOW)
  linksAllowed = true
  deps = {
    uow,
    clock,
    ids: createFakeIdGenerator(),
    tokens: createFakeTokenService(),
    shareLinkPolicy: { allowed: () => linksAllowed },
  }

  for (const [id, parentId] of [
    [DOCUMENT, null],
    [CHILD, DOCUMENT],
  ] as const) {
    await uow.repos.documents.create({
      id,
      shortId: aShortId(),
      workspaceId: '00000000-0000-4000-8000-000000000101' as never,
      collectionId: 'architecture',
      parentId,
      slug: id,
      path: `architecture/${id}.md`,
      title: `Document ${id}`,
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
  }
})

async function create(
  overrides: Partial<Parameters<typeof createShareLink>[1]> = {},
): Promise<{ readonly id: ShareLinkId; readonly token: string }> {
  const result = await createShareLink(deps, {
    documentId: DOCUMENT,
    scope: 'document',
    role: 'viewer',
    expiresAt: null,
    createdBy: AUTHOR,
    ...overrides,
  })
  if (result.kind !== 'created') throw new Error(`expected a link, got ${result.kind}`)
  return { id: result.link.id, token: result.token }
}

describe('createShareLink', () => {
  it('stores only the hash of a token it hands back exactly once', async () => {
    const result = await createShareLink(deps, {
      documentId: DOCUMENT,
      scope: 'subtree',
      role: 'viewer',
      expiresAt: new Date(NOW.getTime() + HOUR),
      createdBy: AUTHOR,
    })

    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return
    expect(result.token).not.toBe('')
    // Only the digest is stored. That the digest gives nothing away is the
    // real adapter's property, tested where SHA-256 actually runs
    // (`apps/server/src/auth/tokens.test.ts`); the fake here hashes by
    // prefixing so that a failure message names the token it meant.
    expect(result.link.tokenHash).toBe(deps.tokens.hash(result.token))
    expect(result.link.scope).toBe('subtree')
    expect(result.link.revokedAt).toBeNull()
    expect(result.link.lastUsedAt).toBeNull()

    // Nothing that is stored, or listed, can give the token back.
    const listed = await listShareLinks(deps, { documentId: DOCUMENT })
    expect(listed.map((row) => row.tokenHash)).not.toContain(result.token)
  })

  it('writes an audit row naming the link, and never the token', async () => {
    const { id, token } = await create()
    const [event] = uow.auditEvents
    expect(event?.type).toBe(SHARE_LINK_AUDIT_EVENTS.created)
    expect(event?.targetType).toBe('share-link')
    expect(event?.targetId).toBe(id)
    expect(event?.actorUserId).toBe(AUTHOR)
    expect(JSON.stringify(uow.auditEvents)).not.toContain(token)
  })

  it('refuses when the organisation does not allow share links', async () => {
    linksAllowed = false
    expect(
      await createShareLink(deps, {
        documentId: DOCUMENT,
        scope: 'document',
        role: 'viewer',
        expiresAt: null,
        createdBy: AUTHOR,
      }),
    ).toEqual({ kind: 'not-allowed' })
    expect(uow.auditEvents).toEqual([])
  })

  it('refuses a role the first release does not carry', async () => {
    expect(
      await createShareLink(deps, {
        documentId: DOCUMENT,
        scope: 'document',
        role: 'editor',
        expiresAt: null,
        createdBy: AUTHOR,
      }),
    ).toEqual({ kind: 'role-unavailable', role: 'editor' })
  })

  it('refuses an expiry that has already passed', async () => {
    const expiresAt = new Date(NOW.getTime() - 1)
    expect(
      await createShareLink(deps, {
        documentId: DOCUMENT,
        scope: 'document',
        role: 'viewer',
        expiresAt,
        createdBy: AUTHOR,
      }),
    ).toEqual({ kind: 'expiry-in-the-past', expiresAt })
  })
})

describe('listShareLinks', () => {
  it('lists a document links newest first, and nothing for a document with none', async () => {
    const first = await create()
    clock.advance(HOUR)
    const second = await create({ scope: 'subtree' })

    expect((await listShareLinks(deps, { documentId: DOCUMENT })).map((row) => row.id)).toEqual([
      second.id,
      first.id,
    ])
    expect(await listShareLinks(deps, { documentId: CHILD })).toEqual([])
  })
})

describe('revokeShareLink', () => {
  it('closes the link, audits who closed it, and is idempotent afterwards', async () => {
    const { id } = await create()
    clock.advance(HOUR)

    const revoked = await revokeShareLink(deps, { shareLinkId: id, revokedBy: AUTHOR })
    expect(revoked.kind).toBe('revoked')
    expect(revoked.kind === 'revoked' && revoked.link.revokedAt).toEqual(clock.now())
    expect(uow.auditEvents.map((event) => event.type)).toEqual([
      SHARE_LINK_AUDIT_EVENTS.created,
      SHARE_LINK_AUDIT_EVENTS.revoked,
    ])

    clock.advance(HOUR)
    const again = await revokeShareLink(deps, { shareLinkId: id, revokedBy: AUTHOR })
    expect(again.kind).toBe('already-revoked')
    // The instant of the first revocation stands, and nothing new is audited.
    expect(again.kind === 'already-revoked' && again.link.revokedAt).toEqual(
      new Date(NOW.getTime() + HOUR),
    )
    expect(uow.auditEvents).toHaveLength(2)
  })

  it('reports a link that is not there', async () => {
    const missing = '00000000-0000-4000-8000-0000000003ff' as ShareLinkId
    expect(await revokeShareLink(deps, { shareLinkId: missing, revokedBy: AUTHOR })).toEqual({
      kind: 'not-found',
    })
  })
})

describe('resolveShareLink', () => {
  it('resolves a live token to its link and the document it targets', async () => {
    const { id, token } = await create()
    const resolved = await resolveShareLink(deps, { token })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.value.link.id).toBe(id)
    expect(resolved.value.document.id).toBe(DOCUMENT)
  })

  it('refuses a token no link carries', async () => {
    await create()
    expect(await resolveShareLink(deps, { token: 'made-up' })).toEqual({
      ok: false,
      error: 'unknown',
    })
  })

  it('refuses an expired link at the instant it expires', async () => {
    const { token } = await create({ expiresAt: new Date(NOW.getTime() + HOUR) })
    clock.advance(HOUR - 1)
    expect((await resolveShareLink(deps, { token })).ok).toBe(true)
    clock.advance(1)
    expect(await resolveShareLink(deps, { token })).toEqual({ ok: false, error: 'expired' })
  })

  it('refuses a revoked link', async () => {
    const { id, token } = await create()
    await revokeShareLink(deps, { shareLinkId: id, revokedBy: AUTHOR })
    expect(await resolveShareLink(deps, { token })).toEqual({ ok: false, error: 'revoked' })
  })

  it('refuses every link when the organisation does not allow them', async () => {
    const { token } = await create()
    linksAllowed = false
    expect(await resolveShareLink(deps, { token })).toEqual({ ok: false, error: 'not-allowed' })
  })

  it('refuses a link whose document has gone, as if the token had never existed', async () => {
    const { token } = await create()
    await uow.repos.documents.delete(DOCUMENT)
    expect(await resolveShareLink(deps, { token })).toEqual({ ok: false, error: 'unknown' })
  })
})

describe('recordShareLinkUse', () => {
  it('audits the first use only, and stamps every one', async () => {
    const { id, token } = await create()
    const first = await resolveShareLink(deps, { token })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    await recordShareLinkUse(deps, { link: first.value.link, actorUserId: null })
    expect(uow.auditEvents.map((event) => event.type)).toEqual([
      SHARE_LINK_AUDIT_EVENTS.created,
      SHARE_LINK_AUDIT_EVENTS.used,
    ])
    expect((await uow.repos.shareLinks.findById(id))?.lastUsedAt).toEqual(NOW)

    clock.advance(HOUR)
    const second = await resolveShareLink(deps, { token })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    await recordShareLinkUse(deps, { link: second.value.link, actorUserId: AUTHOR })

    // One `used` row for the link, and the stamp moved: "when was this last
    // followed" is answered without a row per anonymous read.
    expect(
      uow.auditEvents.filter((event) => event.type === SHARE_LINK_AUDIT_EVENTS.used),
    ).toHaveLength(1)
    expect((await uow.repos.shareLinks.findById(id))?.lastUsedAt).toEqual(clock.now())
  })
})

describe('shareLinkNavigation', () => {
  const GRANDCHILD = documentId('00000000-0000-4000-8000-000000000203')
  const TWIN = documentId('00000000-0000-4000-8000-000000000204')
  const OTHER_COLLECTION = documentId('00000000-0000-4000-8000-000000000205')
  const NEVER_PUBLISHED = documentId('00000000-0000-4000-8000-000000000206')

  async function place(
    id: typeof CHILD,
    parentId: typeof DOCUMENT | null,
    overrides: {
      readonly title?: string
      readonly collectionId?: string
      readonly published?: boolean
    } = {},
  ): Promise<void> {
    await uow.repos.documents.create({
      id,
      shortId: aShortId(),
      workspaceId: '00000000-0000-4000-8000-000000000101' as never,
      collectionId: overrides.collectionId ?? 'architecture',
      parentId,
      slug: id,
      path: `architecture/${id}.md`,
      title: overrides.title ?? `Document ${id}`,
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
    if (overrides.published !== false) {
      await uow.repos.documents.update(id, { headRevision: 'a'.repeat(40) as never }, NOW)
    }
  }

  async function resolved(scope: 'document' | 'subtree') {
    const { token } = await create({ scope })
    const outcome = await resolveShareLink(deps, { token })
    if (!outcome.ok) throw new Error(`expected a resolved link, got ${outcome.error}`)
    return outcome.value
  }

  beforeEach(async () => {
    await uow.repos.documents.update(DOCUMENT, { headRevision: 'a'.repeat(40) as never }, NOW)
    await uow.repos.documents.update(CHILD, { headRevision: 'a'.repeat(40) as never }, NOW)
  })

  it('offers nothing at all when the link is for one document', async () => {
    expect(await shareLinkNavigation(deps, await resolved('document'))).toEqual([])
  })

  it('offers the published subtree, nested, and ordered by title', async () => {
    await place(GRANDCHILD, CHILD, { title: 'Zebra' })
    await place(TWIN, DOCUMENT, { title: 'Alpha' })
    await place(NEVER_PUBLISHED, DOCUMENT, { title: 'Beta', published: false })
    await place(OTHER_COLLECTION, DOCUMENT, { title: 'Gamma', collectionId: 'elsewhere' })

    const navigation = await shareLinkNavigation(deps, await resolved('subtree'))

    // `Alpha` sorts before `Document …`; the unpublished one and the one in
    // another collection are not there at all.
    expect(navigation.map((node) => node.title)).toEqual(['Alpha', `Document ${CHILD}`])
    expect(navigation[1]?.children.map((node) => node.title)).toEqual(['Zebra'])
    expect(navigation[0]?.children).toEqual([])
  })

  it('keeps two documents with the same title, in a stable order', async () => {
    await place(TWIN, DOCUMENT, { title: 'Runbook' })
    await place(GRANDCHILD, DOCUMENT, { title: 'Runbook' })

    const navigation = await shareLinkNavigation(deps, await resolved('subtree'))
    expect(navigation.filter((node) => node.title === 'Runbook')).toHaveLength(2)
    expect(await shareLinkNavigation(deps, await resolved('subtree'))).toEqual(navigation)
  })
})

describe('toShareLink', () => {
  it('projects the row onto what the domain resolves with, and leaves the hash behind', async () => {
    const { id } = await create({ scope: 'subtree' })
    const row = await uow.repos.shareLinks.findById(id)
    expect(row).not.toBeNull()
    if (row === null) return
    expect(toShareLink(row)).toEqual({
      id,
      documentId: DOCUMENT,
      scope: 'subtree',
      role: 'viewer',
      expiresAt: null,
      revokedAt: null,
      createdBy: AUTHOR,
    })
  })
})
