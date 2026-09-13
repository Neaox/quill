import { and, eq } from 'drizzle-orm'

import type { PublicRedirectRepository, PublicRedirectRow } from '@quill/application'
import type { DocumentId } from '@quill/domain'

import { publicRedirects } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/**
 * Where a public page used to answer (ADR-035).
 *
 * One row per `(site, path)`, enforced by a unique index, so a document
 * renamed and renamed back leaves one entry per address rather than a pile of
 * them — and that entry names whichever document holds the address now.
 */

function toRedirectRow(row: typeof publicRedirects.$inferSelect): PublicRedirectRow {
  return {
    id: row.id,
    siteSlug: row.siteSlug,
    path: row.path,
    documentId: row.documentId as DocumentId,
    createdAt: row.createdAt,
  }
}

export function createPublicRedirectRepository(db: DrizzleClient): PublicRedirectRepository {
  return {
    async record(input): Promise<void> {
      await db
        .insert(publicRedirects)
        .values({
          id: input.id,
          siteSlug: input.siteSlug,
          path: input.path,
          documentId: input.documentId,
          createdAt: input.now,
        })
        // The address is the key, so a second rename onto an address somebody
        // else has vacated takes it over rather than failing the consumer.
        .onConflictDoUpdate({
          target: [publicRedirects.siteSlug, publicRedirects.path],
          set: { documentId: input.documentId, createdAt: input.now },
        })
    },

    async find(siteSlug: string, path: string): Promise<PublicRedirectRow | null> {
      const rows = await db
        .select()
        .from(publicRedirects)
        .where(and(eq(publicRedirects.siteSlug, siteSlug), eq(publicRedirects.path, path)))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toRedirectRow(row)
    },

    async deleteAt(siteSlug: string, path: string): Promise<void> {
      await db
        .delete(publicRedirects)
        .where(and(eq(publicRedirects.siteSlug, siteSlug), eq(publicRedirects.path, path)))
    },

    async deleteForSite(siteSlug: string): Promise<void> {
      await db.delete(publicRedirects).where(eq(publicRedirects.siteSlug, siteSlug))
    },
  }
}
