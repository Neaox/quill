import { LINK_PREVIEW_REQUESTED, PUBLIC_PREVIEW_SCOPE } from '@quill/application'
import type { LinkPreviewDependencies } from '@quill/application'
import {
  createFakeClock,
  createFakeIdGenerator,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import { compileLinkPolicy, userId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { fillLinksForMember, fillLinksForPublic } from './fill-links.ts'

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
  const deps: LinkPreviewDependencies = {
    uow,
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
    audiences: { forPerson: async () => audience, forPublic: async () => audience },
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
  return { deps, uow, store }
}

describe('fillLinksForMember', () => {
  it('leaves a body with no link slots exactly as it was, and reads nothing', async () => {
    const { deps } = setUp()
    const filled = await fillLinksForMember(deps, ADA, '<p>No links.</p>')
    expect(filled).toEqual({ html: '<p>No links.</p>', pending: 0 })
  })

  it('draws a stored preview in place of the slot', async () => {
    const { deps, store } = setUp()
    await store()
    const { html, pending } = await fillLinksForMember(deps, ADA, slot(KEY))
    expect(html).toContain('A stored title')
    expect(html).not.toContain('data-link-slot')
    expect(pending).toBe(0)
  })

  it('leaves a link with nothing stored as a plain link, counts it as pending and queues one fetch', async () => {
    const { deps, uow } = setUp()
    const { html, pending } = await fillLinksForMember(deps, ADA, slot(KEY))
    expect(html).toContain('data-link-slot')
    expect(pending).toBe(1)
    expect(uow.events.map((event) => event.type)).toEqual([LINK_PREVIEW_REQUESTED])
  })
})

/** A bare link on a line of its own, whose author chose no display. */
const unchosen = (url: string) =>
  `<p class="link-slot-block"><a href="${url}" data-link-slot="" data-link-key="${url}">${url}</a></p>`

describe('the display of a link its author chose no display for', () => {
  it('is inline when the organisation never said', async () => {
    const { deps, store } = setUp()
    await store()
    const { html } = await fillLinksForMember(deps, ADA, unchosen(KEY))
    expect(html).toContain('link-chip')
    expect(html).not.toContain('link-card')
  })

  it('is the organisation’s default for a member, on a line of its own', async () => {
    const { deps, store } = setUp()
    await store()
    const { html } = await fillLinksForMember(
      { ...deps, defaultDisplay: async () => 'card' },
      ADA,
      unchosen(KEY),
    )
    expect(html).toContain('link-card')
  })

  it('is the organisation’s default for the public site too', async () => {
    const { deps, store } = setUp()
    await store()
    const { html } = await fillLinksForPublic(
      { ...deps, defaultDisplay: async () => 'compact' },
      unchosen(KEY),
    )
    expect(html).toContain('link-compact')
  })

  it('is plain when the organisation made the default a plain link', async () => {
    const { deps, store } = setUp()
    await store()
    const { html } = await fillLinksForMember(
      { ...deps, defaultDisplay: async () => 'url' },
      ADA,
      unchosen(KEY),
    )
    expect(html).toContain('data-link-slot')
    expect(html).not.toContain('A stored title')
  })

  it('does not override what the author chose', async () => {
    const { deps, store } = setUp()
    await store()
    const { html } = await fillLinksForMember(
      { ...deps, defaultDisplay: async () => 'card' },
      ADA,
      slot(KEY).replace('data-display="card"', 'data-display="inline"'),
    )
    expect(html).not.toContain('link-card')
  })
})

describe('fillLinksForPublic', () => {
  it('draws what is stored', async () => {
    const { deps, store } = setUp()
    await store()
    expect((await fillLinksForPublic(deps, slot(KEY))).html).toContain('A stored title')
  })

  it('never queues a fetch for a link nobody has previewed', async () => {
    const { deps, uow } = setUp()
    const { html, pending } = await fillLinksForPublic(deps, slot(KEY))
    expect(html).toContain('data-link-slot')
    expect(pending).toBe(0)
    expect(uow.events).toHaveLength(0)
  })
})
