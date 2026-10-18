import {
  DOCUMENT_PUBLISHED,
  getLinkPreviews,
  parseDocumentPublished,
  renderDocument,
} from '@quill/application'
import type { LinkPreviewDependencies, RenderDocumentDependencies } from '@quill/application'
import { isInternalAddress } from '@quill/domain'
import { scanLinkSlots } from '@quill/markdown'

import type { OutboxConsumer } from './consumer.ts'

/**
 * Queues the previews of a document's links when it is published (ADR-042), so
 * the first reader finds them stored instead of a plain link and a wait.
 *
 * It asks as the publisher, through the same read a member's page load makes,
 * so the publisher's policy decides what may be fetched and their allowance is
 * what is spent. It is only a head start: a failure here costs the first reader
 * a plain link for a moment, which a page load fixes, so it never fails the
 * event and never holds up the consumers beside it.
 */

export function createWarmLinkPreviewsOnPublishConsumer(
  deps: RenderDocumentDependencies & LinkPreviewDependencies,
): OutboxConsumer {
  return {
    eventType: DOCUMENT_PUBLISHED,
    async handle(payload: unknown): Promise<void> {
      const event = parseDocumentPublished(payload)
      if (event === null) return
      try {
        const rendered = await renderDocument(deps, {
          documentId: event.documentId,
          revision: event.revision,
        })
        if (rendered.kind !== 'rendered') return
        // Documents of this instance are read when a page is, never fetched, so there is nothing to warm.
        const urls = scanLinkSlots(rendered.content.html).keys.filter(
          (key) => !isInternalAddress(key),
        )
        if (urls.length > 0) await getLinkPreviews(deps, { userId: event.publishedBy, urls })
      } catch {
        // A head start, not a duty; see above.
      }
    },
  }
}
