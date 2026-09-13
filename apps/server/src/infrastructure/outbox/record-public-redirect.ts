import {
  DOCUMENT_MOVED,
  DOCUMENT_RENAMED,
  parseDocumentMoved,
  parseDocumentRenamed,
  recordMoveRedirect,
  recordRenameRedirect,
} from '@quill/application'
import type { PublicRedirectDependencies } from '@quill/application'

import type { OutboxConsumer } from './consumer.ts'

/**
 * Keeping public addresses working when a page moves (ADR-035).
 *
 * A public URL carries the collection's slug and the document's current title,
 * so a rename or a move between collections changes it. These two consumers
 * are what ADR-035 trades for that readability: the old address is written
 * into `public_redirects` as the row changes, and the route answers it with a
 * `301`.
 *
 * They are consumers rather than part of the rename itself for the ordinary
 * reason (plan §22): the rename is a write to a document, and whether a
 * collection is published is none of its business. A rename in a collection
 * nobody publishes therefore costs two reads and writes nothing.
 *
 * Both are idempotent, which at-least-once delivery requires: recording a
 * redirect is an upsert on the address, and an event this release cannot read
 * is left alone for one that can (ADR-033), exactly as the indexing consumers
 * leave it.
 */

export function createRecordRenameRedirectConsumer(
  deps: PublicRedirectDependencies,
): OutboxConsumer {
  return {
    eventType: DOCUMENT_RENAMED,
    async handle(payload: unknown): Promise<void> {
      const event = parseDocumentRenamed(payload)
      if (event === null) return
      await recordRenameRedirect(deps, {
        documentId: event.documentId,
        previousTitle: event.from,
      })
    },
  }
}

export function createRecordMoveRedirectConsumer(deps: PublicRedirectDependencies): OutboxConsumer {
  return {
    eventType: DOCUMENT_MOVED,
    async handle(payload: unknown): Promise<void> {
      const event = parseDocumentMoved(payload)
      if (event === null) return
      await recordMoveRedirect(deps, {
        documentId: event.documentId,
        fromCollectionId: event.fromCollectionId,
      })
    },
  }
}
