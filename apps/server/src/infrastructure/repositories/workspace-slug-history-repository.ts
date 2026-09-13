import { and, eq, gte } from 'drizzle-orm'

import type { WorkspaceSlugHistoryRepository, WorkspaceSlugHistoryRow } from '@quill/application'
import type { WorkspaceId } from '@quill/domain'

import { workspaceSlugHistory } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/**
 * The forwarding addresses of workspaces that have moved (ADR-035).
 *
 * A slug belongs to one workspace at a time, so recording one is an upsert on
 * the slug: a slug retired, taken by another workspace, and retired again
 * points at whoever gave it up last, and a row nobody has claimed since is
 * left exactly where it was.
 */
export function createWorkspaceSlugHistoryRepository(
  db: DrizzleClient,
): WorkspaceSlugHistoryRepository {
  return {
    async record({ workspaceId, slug, now }): Promise<void> {
      await db
        .insert(workspaceSlugHistory)
        .values({ slug, workspaceId, retiredAt: now })
        .onConflictDoUpdate({
          target: workspaceSlugHistory.slug,
          set: { workspaceId, retiredAt: now },
        })
    },

    async findBySlug(slug: string, cutoff: Date): Promise<WorkspaceSlugHistoryRow | null> {
      const rows = await db
        .select()
        .from(workspaceSlugHistory)
        .where(
          and(eq(workspaceSlugHistory.slug, slug), gte(workspaceSlugHistory.retiredAt, cutoff)),
        )
      const row = rows[0]
      return row === undefined
        ? null
        : {
            workspaceId: row.workspaceId as WorkspaceId,
            slug: row.slug,
            retiredAt: row.retiredAt,
          }
    },
  }
}
