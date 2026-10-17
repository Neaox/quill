import {
  attachmentRevised,
  collectionDeleted,
  documentDeleted,
  documentMoved,
  documentPublished,
  documentRenamed,
  grantCreated,
  grantRevoked,
} from '@quill/application'
import type { EventBus, EventDefinition } from '@quill/application'

import type { PublicSiteCache } from './cache.ts'

/**
 * What tells the public site's in-process cache that something it holds is no
 * longer true (ADR-023, ADR-052).
 *
 * The cache is this process's own, so it is told by the bus rather than by an
 * outbox consumer: an outbox event is claimed by exactly one poller, which is
 * the wrong number of processes to tell, and a poll interval is the wrong
 * delay between revoking access and the cache knowing. The bus announces a
 * commit the moment it happens, in the process that made it.
 *
 * Eight events change what a site shows or who may see it. A publish gives a
 * document a new body; a rename moves its address and its title; a move
 * between collections puts it on a site or takes it off one; a revised
 * attachment — a re-saved draw.io diagram (ADR-043) — changes a body without a
 * publish; a deleted document or collection takes pages away; and a grant
 * created or revoked changes who is allowed to read — a revoke being the one
 * that must not be late, because a stale cache after it is a page somebody
 * still can read.
 *
 * It throws the whole cache away rather than one entry, because the navigation
 * tree is on every page of a site: one document's new title changes every page
 * that lists it, and working out which is more code than rebuilding them. The
 * cost of being wrong is a rebuild; the cost of being clever is a stale
 * navigation nobody can explain.
 *
 * The time to live stays as the backstop for whatever no event covers.
 */
/** The payload is never read, so each is held as the least it promises: that it has a version. */
const INVALIDATING_EVENTS: readonly EventDefinition<{ readonly version: number }>[] = [
  documentPublished,
  documentRenamed,
  documentMoved,
  attachmentRevised,
  documentDeleted,
  collectionDeleted,
  grantCreated,
  grantRevoked,
]

/** Subscribes the cache to every event that can change a site. Returns the unsubscribe. */
export function subscribePublicSiteInvalidation(bus: EventBus, cache: PublicSiteCache): () => void {
  const unsubscribes = INVALIDATING_EVENTS.map((definition) =>
    bus.subscribe(definition, () => {
      cache.invalidate()
    }),
  )
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe()
  }
}
