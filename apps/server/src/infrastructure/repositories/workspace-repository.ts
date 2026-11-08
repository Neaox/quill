import { eq } from 'drizzle-orm'

import type { UnitId, WorkspaceRepository, WorkspaceRow } from '@quill/application'
import { NATIVE_ORIGIN, SOURCED_ORIGIN } from '@quill/domain'
import type { SQL } from 'drizzle-orm'
import type { WorkspaceId } from '@quill/domain'

import { workspaceSources, workspaces } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

/**
 * A workspace is sourced exactly when it has a stored source (ADR-061), so its
 * origin is read in the same query as the row: the authorizer and the
 * refusing content store ask for it on every request.
 */
type StoredWorkspace = typeof workspaces.$inferSelect & { readonly sourced: boolean }

function toWorkspaceRow(row: StoredWorkspace): WorkspaceRow {
  return {
    id: row.id as WorkspaceId,
    unitId: row.unitId as UnitId,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt,
    origin: row.sourced ? SOURCED_ORIGIN : NATIVE_ORIGIN,
  }
}

export function createWorkspaceRepository(db: DrizzleClient): WorkspaceRepository {
  async function select(where?: SQL): Promise<readonly WorkspaceRow[]> {
    const rows = await db
      .select({
        id: workspaces.id,
        unitId: workspaces.unitId,
        name: workspaces.name,
        slug: workspaces.slug,
        createdAt: workspaces.createdAt,
        sourceOf: workspaceSources.workspaceId,
      })
      .from(workspaces)
      .leftJoin(workspaceSources, eq(workspaceSources.workspaceId, workspaces.id))
      .where(where)
    return rows.map(({ sourceOf, ...row }) =>
      toWorkspaceRow({ ...row, sourced: sourceOf !== null }),
    )
  }

  /** A workspace just written: its origin is whatever its source says. */
  async function reread(id: string, context: string): Promise<WorkspaceRow> {
    return requireRow((await select(eq(workspaces.id, id)))[0], context)
  }

  return {
    async create({ id, unitId, name, slug, now }): Promise<WorkspaceRow> {
      const rows = await db
        .insert(workspaces)
        .values({ id, unitId, name, slug, createdAt: now })
        .returning()
      // A new workspace has no source yet.
      const row = requireRow(rows[0], 'create: expected the inserted workspace row back')
      return toWorkspaceRow({ ...row, sourced: false })
    },

    async findById(id: WorkspaceId): Promise<WorkspaceRow | null> {
      return (await select(eq(workspaces.id, id)))[0] ?? null
    },

    async findBySlug(slug: string): Promise<WorkspaceRow | null> {
      return (await select(eq(workspaces.slug, slug)))[0] ?? null
    },

    async listByUnit(unitId: UnitId): Promise<readonly WorkspaceRow[]> {
      return await select(eq(workspaces.unitId, unitId))
    },

    async listAll(): Promise<readonly WorkspaceRow[]> {
      return await select()
    },

    /** An omitted slug is left alone; moving one is a separate instruction (ADR-035). */
    async rename(id: WorkspaceId, name: string, slug?: string): Promise<WorkspaceRow> {
      await db
        .update(workspaces)
        .set({ name, ...(slug === undefined ? {} : { slug }) })
        .where(eq(workspaces.id, id))
      return await reread(id, 'rename: workspace not found')
    },

    async delete(id: WorkspaceId): Promise<void> {
      await db.delete(workspaces).where(eq(workspaces.id, id))
    },
  }
}
