import {
  ATTACHMENT_REVISED,
  DOCUMENT_DELETED,
  DOCUMENT_MOVED,
  DOCUMENT_NESTED,
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
} from '@quill/application'

import type { PublicSiteCache } from '../../public-site/cache.ts'
import type { OutboxConsumer } from './consumer.ts'

/**
 * What tells the public site's in-process cache that a page has changed
 * (ADR-023).
 *
 * Four events change what a published site shows: a publish gives a document
 * a new body, a rename moves its address and its title, a move between
 * collections can put it on a site or take it off one, and a revised
 * attachment — a re-saved draw.io diagram (ADR-043) — changes a body without
 * a publish. Each already has
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
 *
 * Nesting a page under another and deleting one (ADR-056) change the site's
 * navigation and its child pages lists too, so they empty it as well.
 */
export function createInvalidatePublicSiteConsumers(
  cache: PublicSiteCache,
): readonly OutboxConsumer[] {
  return [
    DOCUMENT_PUBLISHED,
    DOCUMENT_RENAMED,
    DOCUMENT_MOVED,
    ATTACHMENT_REVISED,
    DOCUMENT_NESTED,
    DOCUMENT_DELETED,
  ].map((eventType) => ({
    eventType,
    async handle(): Promise<void> {
      cache.invalidate()
    },
  }))
}
