import { and, desc, eq, isNull } from 'drizzle-orm'

import type { CreateShareLinkInput, ShareLinkRepository, ShareLinkRow } from '@quill/application'
import type { DocumentId, Role, ShareLinkId, ShareLinkScope, UserId } from '@quill/domain'

import { shareLinks } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

/**
 * Share links in Postgres (plan section 14).
 *
 * The token never reaches this module: it is hashed above, and `token_hash`
 * is what is written, read, and indexed. `scope_kind`, `scope_id` and
 * `password_hash` are the placeholder columns the first migration shipped and
 * are neither written nor read here (ADR-033, `db/schema.ts`).
 */
function toShareLinkRow(row: typeof shareLinks.$inferSelect): ShareLinkRow {
  return {
    id: row.id as ShareLinkId,
    documentId: row.documentId as DocumentId,
    tokenHash: row.tokenHash,
    scope: row.scope as ShareLinkScope,
    role: row.role as Role,
    expiresAt: row.expiresAt,
    createdBy: row.createdBy as UserId,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }
}

export function createShareLinkRepository(db: DrizzleClient): ShareLinkRepository {
  return {
    async create(input: CreateShareLinkInput): Promise<ShareLinkRow> {
      const rows = await db
        .insert(shareLinks)
        .values({
          id: input.id,
          documentId: input.documentId,
          tokenHash: input.tokenHash,
          scope: input.scope,
          role: input.role,
          expiresAt: input.expiresAt,
          createdBy: input.createdBy,
          revokedAt: null,
          createdAt: input.now,
          lastUsedAt: null,
        })
        .returning()
      return toShareLinkRow(requireRow(rows[0], 'create: expected the inserted share link back'))
    },

    async findByTokenHash(tokenHash: string): Promise<ShareLinkRow | null> {
      const rows = await db.select().from(shareLinks).where(eq(shareLinks.tokenHash, tokenHash))
      const row = rows[0]
      return row === undefined ? null : toShareLinkRow(row)
    },

    async findById(id: ShareLinkId): Promise<ShareLinkRow | null> {
      const rows = await db.select().from(shareLinks).where(eq(shareLinks.id, id))
      const row = rows[0]
      return row === undefined ? null : toShareLinkRow(row)
    },

    async listForDocument(documentId: DocumentId): Promise<readonly ShareLinkRow[]> {
      const rows = await db
        .select()
        .from(shareLinks)
        .where(eq(shareLinks.documentId, documentId))
        .orderBy(desc(shareLinks.createdAt), desc(shareLinks.id))
      return rows.map(toShareLinkRow)
    },

    /**
     * Revocation is the instant the link was *first* closed, so the update
     * only matches a link that is still open. A second revocation therefore
     * changes nothing and the row is read back as it stands.
     */
    async revoke(id: ShareLinkId, now: Date): Promise<ShareLinkRow | null> {
      const updated = await db
        .update(shareLinks)
        .set({ revokedAt: now })
        .where(and(eq(shareLinks.id, id), isNull(shareLinks.revokedAt)))
        .returning()
      const row = updated[0]
      if (row !== undefined) return toShareLinkRow(row)

      const existing = await db.select().from(shareLinks).where(eq(shareLinks.id, id))
      const already = existing[0]
      return already === undefined ? null : toShareLinkRow(already)
    },

    async markUsed(id: ShareLinkId, now: Date): Promise<void> {
      await db.update(shareLinks).set({ lastUsedAt: now }).where(eq(shareLinks.id, id))
    },
  }
}
