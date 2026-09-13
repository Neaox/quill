import { and, count, eq } from 'drizzle-orm'

import type { CollectionId, CollectionRepository, CollectionRow } from '@quill/application'
import type { WorkspaceId } from '@quill/domain'

import { collections, documents } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toCollectionRow(row: typeof collections.$inferSelect): CollectionRow {
  return {
    id: row.id as CollectionId,
    workspaceId: row.workspaceId as WorkspaceId,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt,
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

    async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly CollectionRow[]> {
      const rows = await db
        .select()
        .from(collections)
        .where(eq(collections.workspaceId, workspaceId))
        .orderBy(collections.name)
      return rows.map(toCollectionRow)
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
