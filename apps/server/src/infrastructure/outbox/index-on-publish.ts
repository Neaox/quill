import { DOCUMENT_PUBLISHED, DOCUMENT_RENAMED } from '@quill/application'
import { parseDocumentPublished, parseDocumentRenamed } from '@quill/application'

import { indexDocument } from '../search/index-document.ts'
import type { IndexDocumentDependencies } from '../search/index-document.ts'
import type { OutboxConsumer } from './consumer.ts'

/**
 * The consumers that keep the search index in step with what is published
 * (ADR-010: "indexing is driven by `DocumentPublished` outbox events").
 *
 * Two events matter and a third deliberately does not:
 *
 * - **`DocumentPublished`** is the one that puts content in. A draft is not
 *   findable — it is not published — so nothing before a publish belongs in
 *   the index.
 * - **`DocumentRenamed`** re-projects, because a rename writes the new title
 *   into the document itself (`DocumentFormat.retitle`) and the title is the
 *   most heavily weighted field there is. A rename of a document that has
 *   never been published removes nothing that was never there.
 * - **There is no `DocumentDeleted` consumer**, because `document_search`'s
 *   primary key is a cascading foreign key onto `documents`: deleting a
 *   document removes its index entry in the same transaction that deleted it.
 *   An event doing the same thing afterwards would be a second, slower, and
 *   occasionally wrong way to reach a state the database already guarantees.
 *
 * Both are idempotent, which at-least-once delivery requires: indexing is an
 * upsert, and a document that turns out to be gone or unpublished by the time
 * the event is handled is removed from the index rather than failing the
 * event for ever. An event this release cannot read is left alone, the same
 * way the render consumer leaves it (ADR-033).
 */

export function createIndexOnPublishConsumer(deps: IndexDocumentDependencies): OutboxConsumer {
  return {
    eventType: DOCUMENT_PUBLISHED,
    async handle(payload: unknown): Promise<void> {
      const event = parseDocumentPublished(payload)
      if (event === null) return
      await indexDocument(deps, event.documentId)
    },
  }
}

export function createIndexOnRenameConsumer(deps: IndexDocumentDependencies): OutboxConsumer {
  return {
    eventType: DOCUMENT_RENAMED,
    async handle(payload: unknown): Promise<void> {
      const event = parseDocumentRenamed(payload)
      if (event === null) return
      await indexDocument(deps, event.documentId)
    },
  }
}
