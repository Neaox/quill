import { LINK_PREVIEW_REQUESTED, getLinkPreviews } from '@quill/application'
import type { LinkPreviewFetchDependencies, LinkPreviewResolver } from '@quill/application'
import {
  createFakeClock,
  createFakeIdGenerator,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import { compileLinkPolicy, ok, userId } from '@quill/domain'
import type { LinkPreview } from '@quill/domain'
import { describe, expect, it, vi } from 'vitest'

import { createFetchLinkPreviewConsumer, REDACTED_PATH } from './fetch-link-preview.ts'

const ADA = userId('00000000-0000-4000-8000-00000000000a')
const NOW = new Date('2026-10-13T09:00:00.000Z')
const LIMITS_OPEN = {
  allowFetch: () => ({ allowed: true as const }),
  allowRefresh: () => true,
  allowRead: () => true,
  allowQueued: (_userId: unknown, count: number) => count,
}
const URL_A = 'https://blog.example/post?token=secret-value'

function setUp() {
  const policy = compileLinkPolicy({ mode: 'rich', allow: [], block: [] })
  if (!policy.ok) throw new Error('policy')
  const resolve = vi.fn<LinkPreviewResolver['resolve']>(async (url) =>
    ok<LinkPreview>({
      url,
      canonicalUrl: url,
      title: 'T',
      description: null,
      siteName: null,
      kind: 'website',
      thumbnail: null,
      favicon: null,
      layer: 'page',
      fetchedAt: NOW.toISOString(),
    }),
  )
  const uow = createInMemoryUnitOfWork()
  const deps: LinkPreviewFetchDependencies = {
    uow,
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
    audiences: {
      forPerson: async () => ({ scope: 'public', policy: policy.value }),
      forPublic: () => ({ scope: 'public', policy: policy.value }),
    },
    resolver: { resolve },
    limits: LIMITS_OPEN,
  }
  return { deps, uow, resolve, consumer: createFetchLinkPreviewConsumer(deps) }
}

describe('createFetchLinkPreviewConsumer', () => {
  it('answers LinkPreviewRequested', () => {
    expect(setUp().consumer.eventType).toBe(LINK_PREVIEW_REQUESTED)
  })

  it('fetches the link a reader asked for, so the next read finds it', async () => {
    const { deps, uow, consumer, resolve } = setUp()
    await getLinkPreviews(deps, { userId: ADA, urls: [URL_A] })
    const event = uow.events.find((candidate) => candidate.type === LINK_PREVIEW_REQUESTED)
    await consumer.handle(event?.payload)
    expect(resolve).toHaveBeenCalledOnce()
    const [reading] = await getLinkPreviews(deps, { userId: ADA, urls: [URL_A] })
    expect(reading?.view).toMatchObject({ state: 'ready' })
  })

  it('puts a fetch back for as long as the limit says, rather than failing it', async () => {
    const { deps, uow } = setUp()
    await getLinkPreviews(deps, { userId: ADA, urls: [URL_A] })
    const waiting = createFetchLinkPreviewConsumer({
      ...deps,
      limits: { ...LIMITS_OPEN, allowFetch: () => ({ allowed: false, retryAfterMs: 4200 }) },
    })
    const event = uow.events.find((candidate) => candidate.type === LINK_PREVIEW_REQUESTED)
    await expect(waiting.handle(event?.payload)).rejects.toMatchObject({
      name: 'DeferEvent',
      retryAfterMs: 4200,
    })
  })

  it('lets a real fault through as a fault', async () => {
    const { deps, uow } = setUp()
    await getLinkPreviews(deps, { userId: ADA, urls: [URL_A] })
    const broken = createFetchLinkPreviewConsumer({
      ...deps,
      resolver: {
        resolve: async () => {
          throw new Error('resolver bug')
        },
      },
    })
    const event = uow.events.find((candidate) => candidate.type === LINK_PREVIEW_REQUESTED)
    await expect(broken.handle(event?.payload)).rejects.toThrow('resolver bug')
  })

  it('leaves an event it cannot read alone', async () => {
    const { consumer, resolve } = setUp()
    await consumer.handle({ version: 99 })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('keeps who asked and where, but not the path or query of the link, once it is done', () => {
    const { consumer } = setUp()
    const payload = { version: 1, url: URL_A, scope: 'public', requestedBy: ADA }
    expect(consumer.redactPayload?.(payload)).toEqual({
      version: 1,
      url: `https://blog.example${REDACTED_PATH}`,
      scope: 'public',
      requestedBy: ADA,
    })
  })

  it('never leaves a token in a processed row', () => {
    const { consumer } = setUp()
    const redacted = consumer.redactPayload?.({
      version: 1,
      url: URL_A,
      scope: 'public',
      requestedBy: ADA,
    })
    expect(JSON.stringify(redacted)).not.toContain('secret-value')
  })

  it('redacts a URL it cannot parse entirely, and passes through a payload it cannot read', () => {
    const { consumer } = setUp()
    expect(
      consumer.redactPayload?.({
        version: 1,
        url: 'nope?token=x',
        scope: 'public',
        requestedBy: ADA,
      }),
    ).toMatchObject({
      url: REDACTED_PATH,
    })
    expect(consumer.redactPayload?.('unreadable')).toBe('unreadable')
  })
})
