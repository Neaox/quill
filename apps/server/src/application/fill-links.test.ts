import { LINK_PREVIEW_REQUESTED, PUBLIC_PREVIEW_SCOPE } from '@quill/application'
import type { LinkPreviewDependencies } from '@quill/application'
import {
  createFakeClock,
  createFakeIdGenerator,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import { compileLinkPolicy, createEmbedRegistry, userId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { fillLinksForMember, fillLinksForPublic } from './fill-links.ts'

const ADA = userId('00000000-0000-4000-8000-00000000000a')
const NOW = new Date('2026-10-13T09:00:00.000Z')
const KEY = 'https://blog.example/post'
const EMBEDS = createEmbedRegistry([])

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
    audiences: { forPerson: async () => audience, forPublic: () => audience },
    limits: {
      allowFetch: () => ({ allowed: true }),
      allowRefresh: () => true,
      allowRead: () => true,
      allowQueued: (_person, count) => count,
    },
  }
  const store = (extra: Record<string, unknown> = {}) =>
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
        ...extra,
      },
      now: NOW,
    })
  return { deps, uow, store }
}

describe('fillLinksForMember', () => {
  it('leaves a body with no link slots exactly as it was, and reads nothing', async () => {
    const { deps } = setUp()
    const filled = await fillLinksForMember(deps, ADA, '<p>No links.</p>', EMBEDS)
    expect(filled).toEqual({ html: '<p>No links.</p>', pending: 0 })
  })

  it('draws a stored preview in place of the slot', async () => {
    const { deps, store } = setUp()
    await store()
    const { html, pending } = await fillLinksForMember(deps, ADA, slot(KEY), EMBEDS)
    expect(html).toContain('A stored title')
    expect(html).not.toContain('data-link-slot')
    expect(pending).toBe(0)
  })

  it('leaves a link with nothing stored as a plain link, counts it as pending and queues one fetch', async () => {
    const { deps, uow } = setUp()
    const { html, pending } = await fillLinksForMember(deps, ADA, slot(KEY), EMBEDS)
    expect(html).toContain('data-link-slot')
    expect(pending).toBe(1)
    expect(uow.events.map((event) => event.type)).toEqual([LINK_PREVIEW_REQUESTED])
  })
})

describe('fillLinksForPublic', () => {
  it('draws what is stored', async () => {
    const { deps, store } = setUp()
    await store()
    expect((await fillLinksForPublic(deps, slot(KEY), EMBEDS)).html).toContain('A stored title')
  })

  it('never queues a fetch for a link nobody has previewed', async () => {
    const { deps, uow } = setUp()
    const { html, pending } = await fillLinksForPublic(deps, slot(KEY), EMBEDS)
    expect(html).toContain('data-link-slot')
    expect(pending).toBe(0)
    expect(uow.events).toHaveLength(0)
  })
})

describe('embeds in a filled body', () => {
  const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const embedded = {
    url: VIDEO,
    canonicalUrl: VIDEO,
    embed: {
      provider: 'youtube',
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      aspectRatio: 16 / 9,
    },
  }
  const embedSlot = `<p class="link-slot-block"><a href="${VIDEO}" data-link-slot="" data-link-key="${VIDEO}" data-display="embed">${VIDEO}</a></p>`
  const storeVideo = (uow: ReturnType<typeof setUp>['uow']) =>
    uow.repos.linkPreviews.putReady({
      scope: PUBLIC_PREVIEW_SCOPE,
      key: VIDEO,
      document: {
        version: 1,
        title: 'A talk',
        description: null,
        siteName: 'YouTube',
        kind: 'video',
        thumbnail: null,
        favicon: null,
        layer: 'oembed',
        fetchedAt: NOW.toISOString(),
        ...embedded,
      },
      now: NOW,
    })

  it('draws the frame for a member and for the public alike', async () => {
    const { deps, uow } = setUp()
    await storeVideo(uow)
    const member = await fillLinksForMember(deps, ADA, embedSlot, EMBEDS)
    const anyone = await fillLinksForPublic(deps, embedSlot, EMBEDS)
    for (const { html } of [member, anyone]) {
      expect(html).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
      expect(html).toContain('sandbox="')
    }
  })

  it('draws a card, with no frame, when the operator has switched the provider off', async () => {
    const { deps, uow } = setUp()
    await storeVideo(uow)
    const { html } = await fillLinksForPublic(deps, embedSlot, createEmbedRegistry(['youtube']))
    expect(html).toContain('link-card')
    expect(html).not.toContain('<iframe')
  })
})
