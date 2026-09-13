import { parseDocumentPublished, renderDocument } from '@quill/application'
import { DOCUMENT_PUBLISHED } from '@quill/application'
import type { RenderDocumentDependencies } from '@quill/application'

import type { OutboxConsumer } from './consumer.ts'

/**
 * The consumer the reading view needs (ADR-031).
 *
 * Rendering on `DocumentPublished` is what keeps the first reader from paying
 * for a render. There is no invalidation consumer beside it: a body is cached
 * under a key covering everything it was rendered from, the titles of the
 * documents it links to included, so a rename produces a new key and the next
 * read renders once rather than anything having to go and mark rows stale.
 *
 * An event this release cannot read is left alone rather than failing for
 * ever: the payload carries a version and the reader dispatches on it
 * (ADR-033).
 */

export function createRenderOnPublishConsumer(deps: RenderDocumentDependencies): OutboxConsumer {
  return {
    eventType: DOCUMENT_PUBLISHED,
    async handle(payload: unknown): Promise<void> {
      const event = parseDocumentPublished(payload)
      if (event === null) return
      await renderDocument(deps, { documentId: event.documentId, revision: event.revision })
    },
  }
}
