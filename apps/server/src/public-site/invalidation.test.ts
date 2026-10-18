import {
  attachmentRevised,
  collectionDeleted,
  createEventBus,
  documentDeleted,
  documentMoved,
  documentNested,
  documentPublished,
  documentRenamed,
  EVENT_PAYLOAD_VERSION,
  grantCreated,
  grantRevoked,
} from '@quill/application'
import type { EventDefinition } from '@quill/application'
import { describe, expect, it, vi } from 'vitest'

import { createFakeClock } from '../test-support/fakes.ts'
import { createPublicSiteCache, PUBLIC_SITE_CACHE_TTL_MS } from './cache.ts'
import { subscribePublicSiteInvalidation } from './invalidation.ts'

/**
 * What empties the public site's cache, and — as much to the point — what does
 * not. The cache is process-local, so it is told by the bus (ADR-056): an
 * outbox consumer is claimed by one poller, which is the wrong number of
 * processes to tell.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const v = EVENT_PAYLOAD_VERSION

const PAYLOADS = [
  [
    documentPublished,
    { version: v, documentId: 'd', workspaceId: 'w', revision: 'r', publishedBy: 'u' },
  ],
  [documentRenamed, { version: v, documentId: 'd', workspaceId: 'w', from: 'a', to: 'b' }],
  [documentMoved, { version: v, documentId: 'd', workspaceId: 'w' }],
  [documentNested, { version: v, documentId: 'd', workspaceId: 'w', toParentId: 'p' }],
  [
    attachmentRevised,
    { version: v, attachmentId: 'a', documentId: 'd', workspaceId: 'w', attachmentVersion: 2 },
  ],
  [documentDeleted, { version: v, documentId: 'd', workspaceId: 'w' }],
  [collectionDeleted, { version: v, collectionId: 'c', workspaceId: 'w' }],
  [
    grantCreated,
    {
      version: v,
      grantId: 'g',
      principalKind: 'public',
      scopeKind: 'collection',
      scopeId: 'c',
      role: 'viewer',
      effect: 'allow',
    },
  ],
  [
    grantRevoked,
    {
      version: v,
      grantId: 'g',
      principalKind: 'public',
      scopeKind: 'collection',
      scopeId: 'c',
      role: 'viewer',
      effect: 'allow',
    },
  ],
] as const

function aSubscribedCache() {
  const cache = createPublicSiteCache({
    clock: createFakeClock(NOW),
    ttlMs: PUBLIC_SITE_CACHE_TTL_MS,
  })
  const bus = createEventBus({ onError: vi.fn<(error: unknown) => void>() })
  const unsubscribe = subscribePublicSiteInvalidation(bus, cache)
  cache.rememberPage('acme', 'guides/one', { html: '<p>one</p>', etag: '"one"' })
  cache.rememberSearch('acme', 'limit', undefined, { html: '<p>found</p>', etag: '"found"' })
  return { cache, bus, unsubscribe }
}

describe('invalidating the public site', () => {
  it.each(PAYLOADS)('empties pages and searches when %o happens', async (definition, payload) => {
    const { cache, bus } = aSubscribedCache()
    await bus.publish({ type: (definition as EventDefinition<never>).type, payload })
    expect(cache.page('acme', 'guides/one')).toBeNull()
    expect(cache.search('acme', 'limit', undefined)).toBeNull()
  })

  it('answers for a revoke, which is the one that must not be late', async () => {
    const { cache, bus } = aSubscribedCache()
    await bus.publish({ type: grantRevoked.type, payload: PAYLOADS[8][1] })
    expect(cache.search('acme', 'limit', undefined)).toBeNull()
  })

  it('leaves the cache alone for an event that changes nothing a site shows', async () => {
    const { cache, bus } = aSubscribedCache()
    await bus.publish({ type: 'MailRequested', payload: { version: v } })
    expect(cache.page('acme', 'guides/one')).not.toBeNull()
  })

  it('stops listening when told to', async () => {
    const { cache, bus, unsubscribe } = aSubscribedCache()
    unsubscribe()
    await bus.publish({ type: grantRevoked.type, payload: PAYLOADS[8][1] })
    expect(cache.page('acme', 'guides/one')).not.toBeNull()
  })
})
