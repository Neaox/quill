import { eq } from 'drizzle-orm'

import type { DocumentLinkKind, DocumentLinkRow, DocumentLinksRepository } from '@quill/application'
import type { DocumentId } from '@quill/domain'

import { documentLinks } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

function toLinkRow(row: typeof documentLinks.$inferSelect): DocumentLinkRow {
  return {
    id: row.id,
    sourceDocumentId: row.sourceDocumentId as DocumentId,
    targetDocumentId: row.targetDocumentId as DocumentId | null,
    url: row.url,
    text: row.text,
    kind: row.kind as DocumentLinkKind,
  }
}

/** What each document points at (ADR-031): backlinks, broken links, and rename invalidation. */
export function createDocumentLinksRepository(db: DrizzleClient): DocumentLinksRepository {
  return {
    async replaceForDocument({ documentId, links, idFor }): Promise<void> {
      await db.delete(documentLinks).where(eq(documentLinks.sourceDocumentId, documentId))
      if (links.length === 0) return
      await db.insert(documentLinks).values(
        links.map((link, index) => ({
          id: idFor(index),
          sourceDocumentId: documentId,
          targetDocumentId: link.targetDocumentId,
          url: link.url,
          text: link.text,
          kind: link.kind,
        })),
      )
    },

    async listForDocument(documentId: DocumentId): Promise<readonly DocumentLinkRow[]> {
      const rows = await db
        .select()
        .from(documentLinks)
        .where(eq(documentLinks.sourceDocumentId, documentId))
      return rows.map(toLinkRow)
    },

    async listSourcesTargeting(documentId: DocumentId): Promise<readonly DocumentId[]> {
      const rows = await db
        .selectDistinct({ sourceDocumentId: documentLinks.sourceDocumentId })
        .from(documentLinks)
        .where(eq(documentLinks.targetDocumentId, documentId))
      return rows.map((row) => row.sourceDocumentId as DocumentId)
    },
  }
}
