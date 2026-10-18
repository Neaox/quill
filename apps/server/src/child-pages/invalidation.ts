import {
  documentCreated,
  documentDeleted,
  documentMoved,
  documentNested,
  documentPublished,
  documentRenamed,
} from '@quill/application'
import type { EventBus, EventDefinition, UnitOfWork } from '@quill/application'
import { isUuid } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import type { ServerChildPagesCache } from './cache.ts'

/**
 * What tells the child pages cache a subtree changed (ADR-058).
 *
 * The cache is this process's own, so, like the public site's, it is told by
 * the in-process bus once the commit lands (ADR-056) rather than by an outbox
 * consumer, which is claimed by one poller and so tells one process.
 *
 * Six events change a list: a page created under a parent, published (its
 * title, summary or status), renamed, moved between collections, nested under
 * another parent, or deleted. Each names one document. The entries that can
 * have changed are the ones holding it — its old place, through the cache's
 * own record of each subtree — and the ones above its new place, which one
 * query for its ancestors answers. A deleted document has no ancestors left
 * to read; the entries holding it are exactly the ones that listed it. A
 * payload naming something that is no document id clears everything rather
 * than asking the database about it.
 */
/** Every payload names its document; that is all this needs of it. */
export const CHILD_PAGES_EVENTS: readonly EventDefinition<{
  readonly version: number
  readonly documentId: DocumentId
}>[] = [
  documentCreated,
  documentPublished,
  documentRenamed,
  documentMoved,
  documentNested,
  documentDeleted,
]

/** Subscribes the cache to every event that can change a list. Returns the unsubscribe. */
export function subscribeChildPagesInvalidation(
  bus: EventBus,
  cache: ServerChildPagesCache,
  deps: { readonly uow: UnitOfWork },
): () => void {
  const unsubscribes = CHILD_PAGES_EVENTS.map((definition) =>
    bus.subscribe(definition, async ({ documentId }) => {
      if (!isUuid(documentId)) {
        cache.clear()
        return
      }
      const above = await deps.uow.repos.documents.listAncestors(documentId)
      cache.invalidate([documentId, ...above.map((row) => row.id)])
    }),
  )
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe()
  }
}
