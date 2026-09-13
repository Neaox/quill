import { DOCUMENT_MOVED, DOCUMENT_PUBLISHED, DOCUMENT_RENAMED } from '@quill/application'
import { describe, expect, it } from 'vitest'

import { createPublicSiteCache, PUBLIC_SITE_CACHE_TTL_MS } from '../../public-site/cache.ts'
import { createFakeClock } from '../../test-support/fakes.ts'
import { createInvalidatePublicSiteConsumers } from './invalidate-public-site.ts'

/**
 * The three events that change what a published page says, and the cache they
 * empty.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')

function consumers() {
  const cache = createPublicSiteCache({
    clock: createFakeClock(NOW),
    ttlMs: PUBLIC_SITE_CACHE_TTL_MS,
  })
  return { cache, consumers: createInvalidatePublicSiteConsumers(cache) }
}

describe('invalidating the public site', () => {
  it('is registered for publishing, renaming and moving, and for nothing else', () => {
    expect(consumers().consumers.map((consumer) => consumer.eventType)).toEqual([
      DOCUMENT_PUBLISHED,
      DOCUMENT_RENAMED,
      DOCUMENT_MOVED,
    ])
  })

  it('empties the cache on each of them', async () => {
    for (const [index] of [DOCUMENT_PUBLISHED, DOCUMENT_RENAMED, DOCUMENT_MOVED].entries()) {
      const { cache, consumers: registered } = consumers()
      cache.rememberPage('acme', 'guides/one', { html: '<p>one</p>', etag: '"one"' })
      await registered[index]?.handle({ version: 1 })
      expect(cache.page('acme', 'guides/one')).toBeNull()
    }
  })

  /**
   * Every other consumer leaves a payload it cannot read for a release that
   * can (ADR-033). That is right when the consumer acts on the payload; this
   * one only needs to know that something happened, and a page rendered before
   * an event it cannot read is exactly as stale as one rendered before an
   * event it can.
   */
  it('empties the cache even for a payload this release cannot read', async () => {
    const { cache, consumers: registered } = consumers()
    cache.rememberSite('acme', { siteSlug: 'acme' } as never)
    await registered[0]?.handle({ version: 99 })
    expect(cache.site('acme')).toBeNull()
  })
})
