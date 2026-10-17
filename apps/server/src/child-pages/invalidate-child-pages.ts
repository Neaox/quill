import {
  DOCUMENT_CREATED,
  DOCUMENT_DELETED,
  DOCUMENT_MOVED,
  DOCUMENT_NESTED,
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
} from '@quill/application'
import type { UnitOfWork } from '@quill/application'
import { documentId, isUuid } from '@quill/domain'

import type { OutboxConsumer } from '../infrastructure/outbox/consumer.ts'
import type { ServerChildPagesCache } from './cache.ts'

/**
 * What tells the child pages cache a subtree changed (ADR-056).
 *
 * Six events change a list: a page created under a parent, published (its
 * title, summary or status), renamed, moved between collections, nested under
 * another parent, or deleted. Each names one document. The entries that can
 * have changed are the ones holding it — its old place, through the cache's
 * own record of each subtree — and the ones above its new place, which one
 * query for its ancestors answers. A deleted document has no ancestors left
 * to read; the entries holding it are exactly the ones that listed it.
 *
 * An event this release cannot read clears everything: like the public
 * site's invalidation, this consumer only needs to know something happened.
 */
export const CHILD_PAGES_EVENTS = [
  DOCUMENT_CREATED,
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
  DOCUMENT_MOVED,
  DOCUMENT_NESTED,
  DOCUMENT_DELETED,
] as const

function documentOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const value: unknown = Reflect.get(payload, 'documentId')
  return typeof value === 'string' && isUuid(value) ? value : undefined
}

export function createInvalidateChildPagesConsumers(
  cache: ServerChildPagesCache,
  deps: { readonly uow: UnitOfWork },
): readonly OutboxConsumer[] {
  return CHILD_PAGES_EVENTS.map((eventType) => ({
    eventType,
    async handle(payload: unknown): Promise<void> {
      const named = documentOf(payload)
      if (named === undefined) {
        cache.clear()
        return
      }
      const changed = documentId(named)
      const above = await deps.uow.repos.documents.listAncestors(changed)
      cache.invalidate([changed, ...above.map((row) => row.id)])
    },
  }))
}
