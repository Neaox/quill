import { and, count, eq } from 'drizzle-orm'

import type {
  CollectionId,
  CollectionRepository,
  CollectionRow,
  PublicSiteSettings,
  SetPublicSiteOutcome,
} from '@quill/application'
import type { DocumentId, WorkspaceId } from '@quill/domain'

import { collections, documents } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

/**
 * Whether an error is the database refusing a duplicate on a named constraint.
 *
 * `23505` is PostgreSQL's `unique_violation`; the constraint name is checked as
 * well as the code, so a different index on the same table is never mistaken
 * for this one and swallowed. Drizzle wraps the driver's error in one of its
 * own, so the chain of `cause`s is walked rather than only the top: what the
 * caller is handed says "failed query", and what the database said is inside
 * it.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current = error; current !== null && current !== undefined;) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown }
    if (candidate.code === '23505' && candidate.constraint === constraint) return true
    current = candidate.cause
  }
  return false
}

function toCollectionRow(row: typeof collections.$inferSelect): CollectionRow {
  return {
    id: row.id as CollectionId,
    workspaceId: row.workspaceId as WorkspaceId,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt,
    publicSite: toPublicSite(row),
  }
}

/**
 * The publish settings, or null for a collection that has never been
 * published.
 *
 * The slug is what says a site exists at all: `public_enabled` is only the
 * switch, and a site that is off keeps its address so that turning it back on
 * answers where it always did (ADR-023).
 */
function toPublicSite(row: typeof collections.$inferSelect): PublicSiteSettings | null {
  return row.publicSiteSlug === null
    ? null
    : {
        enabled: row.publicEnabled,
        siteSlug: row.publicSiteSlug,
        homeDocumentId: row.publicHomeDocumentId as DocumentId | null,
      }
}

export function createCollectionRepository(db: DrizzleClient): CollectionRepository {
  return {
    async create(input): Promise<CollectionRow> {
      const rows = await db
        .insert(collections)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          name: input.name,
          slug: input.slug,
          createdAt: input.now,
        })
        .returning()
      return toCollectionRow(
        requireRow(rows[0], 'create: expected the inserted collection row back'),
      )
    },

    async findById(id: CollectionId): Promise<CollectionRow | null> {
      const rows = await db.select().from(collections).where(eq(collections.id, id))
      const row = rows[0]
      return row === undefined ? null : toCollectionRow(row)
    },

    async findBySlug(workspaceId: WorkspaceId, slug: string): Promise<CollectionRow | null> {
      const rows = await db
        .select()
        .from(collections)
        .where(and(eq(collections.workspaceId, workspaceId), eq(collections.slug, slug)))
      const row = rows[0]
      return row === undefined ? null : toCollectionRow(row)
    },

    async findBySiteSlug(siteSlug: string): Promise<CollectionRow | null> {
      const rows = await db
        .select()
        .from(collections)
        .where(eq(collections.publicSiteSlug, siteSlug))
      const row = rows[0]
      return row === undefined ? null : toCollectionRow(row)
    },

    async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly CollectionRow[]> {
      const rows = await db
        .select()
        .from(collections)
        .where(eq(collections.workspaceId, workspaceId))
        .orderBy(collections.name)
      return rows.map(toCollectionRow)
    },

    async listPublicSites(): Promise<readonly CollectionRow[]> {
      const rows = await db
        .select()
        .from(collections)
        .where(eq(collections.publicEnabled, true))
        .orderBy(collections.publicSiteSlug)
      return rows.map(toCollectionRow)
    },

    async setPublicSite(
      id: CollectionId,
      settings: PublicSiteSettings,
    ): Promise<SetPublicSiteOutcome> {
      try {
        const rows = await db
          .update(collections)
          .set({
            publicEnabled: settings.enabled,
            publicSiteSlug: settings.siteSlug,
            publicHomeDocumentId: settings.homeDocumentId,
          })
          .where(eq(collections.id, id))
          .returning()
        return {
          kind: 'written',
          collection: toCollectionRow(requireRow(rows[0], 'setPublicSite: collection not found')),
        }
      } catch (error) {
        // The address is claimed by the index, so the loser of a race is told
        // the same thing as a caller who was simply second: a `409`, not a
        // server fault (`routes/collections.ts`).
        if (!isUniqueViolation(error, 'collections_public_site_slug_key')) throw error
        return { kind: 'slug-taken' }
      }
    },

    async rename(id: CollectionId, name: string): Promise<CollectionRow> {
      const rows = await db
        .update(collections)
        .set({ name })
        .where(eq(collections.id, id))
        .returning()
      return toCollectionRow(requireRow(rows[0], 'rename: collection not found'))
    },

    async delete(id: CollectionId): Promise<void> {
      await db.delete(collections).where(eq(collections.id, id))
    },

    async countDocuments(id: CollectionId): Promise<number> {
      const rows = await db
        .select({ total: count() })
        .from(documents)
        .where(eq(documents.collectionId, id))
      return requireRow(rows[0], 'countDocuments: expected a count row').total
    },
  }
}
