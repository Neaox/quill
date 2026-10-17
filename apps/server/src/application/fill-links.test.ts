import { LINK_PREVIEW_REQUESTED, PUBLIC_PREVIEW_SCOPE, createAuthorizer } from '@quill/application'
import type { LinkPreviewDependencies } from '@quill/application'
import {
  aShortId,
  createFakeClock,
  createFakeIdGenerator,
  createFakeTokenService,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import { compileLinkPolicy, documentId, userId, workspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { fillLinksForMember, fillLinksForPublic } from './fill-links.ts'
import type { InternalLinks } from './fill-links.ts'

const ADA = userId('00000000-0000-4000-8000-00000000000a')
const NOW = new Date('2026-10-13T09:00:00.000Z')
const KEY = 'https://blog.example/post'

const slot = (url: string) =>
  `<p><a href="${url}" data-link-slot="" data-link-key="${url}" data-display="card">${url}</a></p>`

function setUp() {
  const policy = compileLinkPolicy({ mode: 'rich', allow: [], block: [] })
  if (!policy.ok) throw new Error('policy')
  const audience = { scope: PUBLIC_PREVIEW_SCOPE, policy: policy.value }
  const uow = createInMemoryUnitOfWork()
  const clock = createFakeClock(NOW)
  const deps: LinkPreviewDependencies = {
    uow,
    clock,
    ids: createFakeIdGenerator(),
    audiences: { forPerson: async () => audience, forPublic: () => audience },
    limits: {
      allowFetch: () => ({ allowed: true }),
      allowRefresh: () => true,
      allowRead: () => true,
      allowQueued: (_person, count) => count,
    },
  }
  const store = () =>
    uow.repos.linkPreviews.putReady({
      scope: PUBLIC_PREVIEW_SCOPE,
      key: KEY,
      document: {
        version: 1,
        url: KEY,
        canonicalUrl: KEY,
        title: 'A stored title',
        description: null,
        siteName: null,
        kind: 'website',
        thumbnail: null,
        favicon: null,
        layer: 'page',
        fetchedAt: NOW.toISOString(),
      },
      now: NOW,
    })
  /** The documents a body links to, read for `who`, with a description that names the document. */
  const internal = (who: typeof ADA): InternalLinks => ({
    deps: { uow, describe: async (id) => `About ${id.slice(-3)}.` },
    viewer: {
      kind: 'authorized',
      authorizer: createAuthorizer(
        uow.repos,
        { userId: who, shareLinkToken: null },
        {
          uow,
          clock,
          ids: createFakeIdGenerator('1111'),
          tokens: createFakeTokenService(),
          shareLinkPolicy: { allowed: () => true },
        },
      ),
    },
  })
  return { deps, uow, store, internal }
}

describe('fillLinksForMember', () => {
  it('leaves a body with no link slots exactly as it was, and reads nothing', async () => {
    const { deps, internal } = setUp()
    const filled = await fillLinksForMember(deps, ADA, '<p>No links.</p>', internal(ADA))
    expect(filled).toEqual({ html: '<p>No links.</p>', pending: 0 })
  })

  it('draws a stored preview in place of the slot', async () => {
    const { deps, store, internal } = setUp()
    await store()
    const { html, pending } = await fillLinksForMember(deps, ADA, slot(KEY), internal(ADA))
    expect(html).toContain('A stored title')
    expect(html).not.toContain('data-link-slot')
    expect(pending).toBe(0)
  })

  it('leaves a link with nothing stored as a plain link, counts it as pending and queues one fetch', async () => {
    const { deps, uow, internal } = setUp()
    const { html, pending } = await fillLinksForMember(deps, ADA, slot(KEY), internal(ADA))
    expect(html).toContain('data-link-slot')
    expect(pending).toBe(1)
    expect(uow.events.map((event) => event.type)).toEqual([LINK_PREVIEW_REQUESTED])
  })
})

describe('fillLinksForPublic', () => {
  it('draws what is stored', async () => {
    const { deps, store, internal } = setUp()
    await store()
    expect((await fillLinksForPublic(deps, slot(KEY), internal(ADA))).html).toContain(
      'A stored title',
    )
  })

  it('never queues a fetch for a link nobody has previewed', async () => {
    const { deps, uow, internal } = setUp()
    const { html, pending } = await fillLinksForPublic(deps, slot(KEY), internal(ADA))
    expect(html).toContain('data-link-slot')
    expect(pending).toBe(0)
    expect(uow.events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Links to documents of this instance (ADR-042, "Internal links")
// ---------------------------------------------------------------------------

const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const VISIBLE = documentId('00000000-0000-4000-8000-000000000201')
const HIDDEN = documentId('00000000-0000-4000-8000-000000000202')

async function seedDocuments(uow: ReturnType<typeof createInMemoryUnitOfWork>) {
  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'runbooks',
    workspaceId: WORKSPACE,
    name: 'Runbooks',
    slug: 'runbooks',
    now: NOW,
  })
  await uow.repos.users.create({ id: ADA, email: 'ada@example.com', displayName: 'Ada', now: NOW })
  for (const [id, title] of [
    [VISIBLE, 'Deploy runbook'],
    [HIDDEN, 'Layoff plan'],
  ] as const) {
    await uow.repos.documents.create({
      id,
      shortId: aShortId(Number(id.slice(-3))),
      workspaceId: WORKSPACE,
      collectionId: 'runbooks',
      parentId: null,
      slug: id,
      path: `runbooks/${id}.md`,
      title,
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
  }
  await uow.repos.grants.create({
    id: 'g1',
    principalKind: 'user',
    principalId: ADA,
    effect: 'allow',
    role: 'viewer',
    scopeKind: 'document',
    scopeId: VISIBLE,
    createdBy: null,
    now: NOW,
  })
}

const documentSlot = (id: string, display = 'card') =>
  `<p class="link-slot-block"><a href="/d/${id}" data-link-slot="" data-link-key="/d/${id}" data-link-internal="" data-display="${display}">/d/${id}</a></p>`

describe('links to documents of this instance', () => {
  it('draws a document the reader may view with its live title and description', async () => {
    const { deps, uow, internal } = setUp()
    await seedDocuments(uow)
    const { html } = await fillLinksForMember(deps, ADA, documentSlot(VISIBLE), internal(ADA))
    expect(html).toContain('Deploy runbook')
    expect(html).toContain('About 201.')
    expect(html).toContain(`href="/d/${VISIBLE}"`)
  })

  it('draws a document the reader may not view as an unlinked label that names nothing', async () => {
    const { deps, uow, internal } = setUp()
    await seedDocuments(uow)
    const { html } = await fillLinksForMember(deps, ADA, documentSlot(HIDDEN), internal(ADA))
    expect(html).not.toContain('Layoff')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain(HIDDEN)
    expect(html).toContain('link-unavailable')
  })

  it('does not describe a link that will not show a description', async () => {
    const { deps, uow, internal } = setUp()
    await seedDocuments(uow)
    const { html } = await fillLinksForMember(
      deps,
      ADA,
      documentSlot(VISIBLE, 'inline'),
      internal(ADA),
    )
    expect(html).not.toContain('About 201.')
  })

  it('is never counted as pending and never queues a fetch', async () => {
    const { deps, uow, internal } = setUp()
    await seedDocuments(uow)
    const { pending } = await fillLinksForMember(
      deps,
      ADA,
      documentSlot(VISIBLE) + documentSlot(HIDDEN),
      internal(ADA),
    )
    expect(pending).toBe(0)
    expect(uow.events).toHaveLength(0)
  })

  it('is answered for the reader even on the anonymous path, so a share link is not a member', async () => {
    const { deps, uow, internal } = setUp()
    await seedDocuments(uow)
    const stranger = userId('00000000-0000-4000-8000-0000000000ff')
    const { html } = await fillLinksForPublic(deps, documentSlot(VISIBLE), internal(stranger))
    expect(html).not.toContain('Deploy runbook')
    expect(html).toContain('link-unavailable')
  })
})
