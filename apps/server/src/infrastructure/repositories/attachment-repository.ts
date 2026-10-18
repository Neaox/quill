import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import type { AttachmentRepository, AttachmentRow } from '@quill/application'
import type { DocumentId, UserId, WorkspaceId } from '@quill/domain'

import { attachmentRevisions, attachments } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toAttachmentRow(row: typeof attachments.$inferSelect): AttachmentRow {
  return {
    id: row.id,
    documentId: row.documentId as DocumentId,
    workspaceId: row.workspaceId as WorkspaceId,
    uploadedBy: row.uploadedBy as UserId | null,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    sha256: row.sha256,
    version: row.version,
    searchText: row.searchText,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  }
}

/** What each document carries (plan §11). The bytes live in the blob store, addressed by `sha256`. */
export function createAttachmentRepository(db: DrizzleClient): AttachmentRepository {
  return {
    async create(input): Promise<AttachmentRow> {
      const inserted = await db
        .insert(attachments)
        .values({
          id: input.id,
          documentId: input.documentId,
          workspaceId: input.workspaceId,
          uploadedBy: input.uploadedBy,
          filename: input.filename,
          contentType: input.contentType,
          size: input.size,
          sha256: input.sha256,
          searchText: input.searchText ?? null,
          createdAt: input.now,
        })
        .returning()
      return toAttachmentRow(requireRow(inserted[0], 'insert returned no attachment row'))
    },

    async findById(id): Promise<AttachmentRow | null> {
      const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toAttachmentRow(row)
    },

    async listForDocument(documentId): Promise<readonly AttachmentRow[]> {
      const rows = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.documentId, documentId), isNull(attachments.deletedAt)))
        .orderBy(asc(attachments.createdAt), asc(attachments.id))
      return rows.map(toAttachmentRow)
    },

    async listLiveInWorkspace(workspaceId, ids): Promise<readonly AttachmentRow[]> {
      if (ids.length === 0) return []
      const rows = await db
        .select()
        .from(attachments)
        .where(
          and(
            inArray(attachments.id, [...ids]),
            eq(attachments.workspaceId, workspaceId),
            isNull(attachments.deletedAt),
          ),
        )
      return rows.map(toAttachmentRow)
    },

    async softDelete(id, now): Promise<void> {
      // Guarded on `deleted_at IS NULL` so a second removal keeps the first
      // one's timestamp: when it went is a fact, and re-stamping it would make
      // the audit row and the column disagree.
      await db
        .update(attachments)
        .set({ deletedAt: now })
        .where(and(eq(attachments.id, id), isNull(attachments.deletedAt)))
    },

    async revise(input): Promise<AttachmentRow | null> {
      // Compare-and-set on the version the writer edited. The read locks the
      // row it matched, so of two saves racing from the same version one waits
      // for the other and then no longer matches, and writes nothing; the
      // state replaced is kept in the same transaction as the update that
      // replaces it, so neither can land without the other.
      const live = and(
        eq(attachments.id, input.id),
        eq(attachments.version, input.expectedVersion),
        isNull(attachments.deletedAt),
      )
      return await db.transaction(async (tx) => {
        const [previous] = await tx.select().from(attachments).where(live).limit(1).for('update')
        if (previous === undefined) return null
        const revised = await tx
          .update(attachments)
          .set({
            contentType: input.contentType,
            size: input.size,
            sha256: input.sha256,
            searchText: input.searchText,
            version: input.expectedVersion + 1,
            revisedBy: input.revisedBy,
            revisedAt: input.now,
          })
          .where(live)
          .returning()
        await tx.insert(attachmentRevisions).values({
          attachmentId: previous.id,
          version: previous.version,
          contentType: previous.contentType,
          size: previous.size,
          sha256: previous.sha256,
          savedBy: previous.revisedBy ?? previous.uploadedBy,
          savedAt: previous.revisedAt ?? previous.createdAt,
          replacedAt: input.now,
        })
        return toAttachmentRow(requireRow(revised[0], 'revise: expected the revised row back'))
      })
    },
  }
}
