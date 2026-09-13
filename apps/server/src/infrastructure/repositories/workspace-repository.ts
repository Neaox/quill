import { eq } from 'drizzle-orm'

import type { UnitId, WorkspaceRepository, WorkspaceRow } from '@quill/application'
import type { WorkspaceId } from '@quill/domain'

import { workspaces } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toWorkspaceRow(row: typeof workspaces.$inferSelect): WorkspaceRow {
  return {
    id: row.id as WorkspaceId,
    unitId: row.unitId as UnitId,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt,
  }
}

export function createWorkspaceRepository(db: DrizzleClient): WorkspaceRepository {
  return {
    async create({ id, unitId, name, slug, now }): Promise<WorkspaceRow> {
      const rows = await db
        .insert(workspaces)
        .values({ id, unitId, name, slug, createdAt: now })
        .returning()
      return toWorkspaceRow(requireRow(rows[0], 'create: expected the inserted workspace row back'))
    },

    async findById(id: WorkspaceId): Promise<WorkspaceRow | null> {
      const rows = await db.select().from(workspaces).where(eq(workspaces.id, id))
      const row = rows[0]
      return row === undefined ? null : toWorkspaceRow(row)
    },

    async findBySlug(slug: string): Promise<WorkspaceRow | null> {
      const rows = await db.select().from(workspaces).where(eq(workspaces.slug, slug))
      const row = rows[0]
      return row === undefined ? null : toWorkspaceRow(row)
    },

    async listByUnit(unitId: UnitId): Promise<readonly WorkspaceRow[]> {
      const rows = await db.select().from(workspaces).where(eq(workspaces.unitId, unitId))
      return rows.map(toWorkspaceRow)
    },

    async listAll(): Promise<readonly WorkspaceRow[]> {
      const rows = await db.select().from(workspaces)
      return rows.map(toWorkspaceRow)
    },

    /** An omitted slug is left alone; moving one is a separate instruction (ADR-035). */
    async rename(id: WorkspaceId, name: string, slug?: string): Promise<WorkspaceRow> {
      const rows = await db
        .update(workspaces)
        .set({ name, ...(slug === undefined ? {} : { slug }) })
        .where(eq(workspaces.id, id))
        .returning()
      return toWorkspaceRow(requireRow(rows[0], 'rename: workspace not found'))
    },

    async delete(id: WorkspaceId): Promise<void> {
      await db.delete(workspaces).where(eq(workspaces.id, id))
    },
  }
}
