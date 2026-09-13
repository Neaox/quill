import { DOCUMENT_MOVED, DOCUMENT_PUBLISHED, DOCUMENT_RENAMED } from '@quill/application'

import type { PublicSiteCache } from '../../public-site/cache.ts'
import type { OutboxConsumer } from './consumer.ts'

/**
 * What tells the public site's in-process cache that a page has changed
 * (ADR-023).
 *
 * Three events change what a published site shows: a publish gives a document
 * a new body, a rename moves its address and its title, and a move between
 * collections can put it on a site or take it off one. Each already has
 * consumers — indexing, rendering, the redirect table — so this is a fourth
 * registered beside them rather than a second delivery mechanism.
 *
 * It throws the whole cache away rather than one entry, because the navigation
 * tree is on every page of a site: one document's new title changes every page
 * that lists it, and working out which is more code than rebuilding them. The
 * cost of being wrong is a rebuild; the cost of being clever is a stale
 * navigation nobody can explain.
 *
 * A payload this release cannot read invalidates anyway. Every other consumer
 * leaves an unreadable event for a release that understands it (ADR-033), and
 * that is right when the consumer *does* something with the payload; this one
 * only needs to know that something happened.
 */
export function createInvalidatePublicSiteConsumers(
  cache: PublicSiteCache,
): readonly OutboxConsumer[] {
  return [DOCUMENT_PUBLISHED, DOCUMENT_RENAMED, DOCUMENT_MOVED].map((eventType) => ({
    eventType,
    async handle(): Promise<void> {
      cache.invalidate()
    },
  }))
}
