import { and, eq } from 'drizzle-orm'

import type {
  RefusedSourceFile,
  SourcePathMapRepository,
  SourcePathRow,
  SourceSyncFailure,
  SourceSyncStateRepository,
  SourceSyncStateRow,
} from '@quill/application'
import type { DocumentId, WorkspaceId } from '@quill/domain'

import { sourcePathMap, sourceSyncState } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/**
 * The sync job's own tables (ADR-061): the path map that gives a source's
 * files their ids, and how far each sourced workspace has synced.
 */

export function createSourcePathMapRepository(db: DrizzleClient): SourcePathMapRepository {
  return {
    async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourcePathRow[]> {
      const rows = await db
        .select()
        .from(sourcePathMap)
        .where(eq(sourcePathMap.workspaceId, workspaceId))
      return rows.map((row) => ({
        workspaceId: row.workspaceId as WorkspaceId,
        path: row.path,
        documentId: row.documentId as DocumentId,
        archivedAt: row.archivedAt,
      }))
    },

    async put(row: SourcePathRow, now: Date): Promise<void> {
      const values = { documentId: row.documentId, archivedAt: row.archivedAt, updatedAt: now }
      await db
        .insert(sourcePathMap)
        .values({ workspaceId: row.workspaceId, path: row.path, ...values })
        .onConflictDoUpdate({
          target: [sourcePathMap.workspaceId, sourcePathMap.path],
          set: values,
        })
    },

    async remove(workspaceId: WorkspaceId, path: string): Promise<void> {
      await db
        .delete(sourcePathMap)
        .where(and(eq(sourcePathMap.workspaceId, workspaceId), eq(sourcePathMap.path, path)))
    },
  }
}

/** The version of the `failure` and `refused` documents, so a later release can read them (ADR-033). */
const STATE_VERSION = 1

export function createSourceSyncStateRepository(db: DrizzleClient): SourceSyncStateRepository {
  return {
    async find(workspaceId: WorkspaceId): Promise<SourceSyncStateRow | null> {
      const rows = await db
        .select()
        .from(sourceSyncState)
        .where(eq(sourceSyncState.workspaceId, workspaceId))
        .limit(1)
      const row = rows[0]
      if (row === undefined) return null
      return {
        workspaceId: row.workspaceId as WorkspaceId,
        lastSyncedRevision: row.lastSyncedRevision,
        lastSyncedAt: row.lastSyncedAt,
        lastAttemptAt: row.lastAttemptAt,
        failure: readFailure(row.failure),
        refused: readRefused(row.refused),
      }
    },

    async recordSynced({ workspaceId, revision, refused, now }): Promise<void> {
      const values = {
        lastSyncedRevision: revision,
        lastSyncedAt: now,
        lastAttemptAt: now,
        failure: null,
        refused: { version: STATE_VERSION, files: refused },
      }
      await db
        .insert(sourceSyncState)
        .values({ workspaceId, ...values })
        .onConflictDoUpdate({ target: sourceSyncState.workspaceId, set: values })
    },

    /** Leaves what was synced, and what was refused getting there, as it was. */
    async recordFailure({ workspaceId, failure, now }): Promise<void> {
      const stored = { version: STATE_VERSION, ...failure }
      await db
        .insert(sourceSyncState)
        .values({
          workspaceId,
          lastAttemptAt: now,
          failure: stored,
          refused: { version: STATE_VERSION, files: [] },
        })
        .onConflictDoUpdate({
          target: sourceSyncState.workspaceId,
          set: { lastAttemptAt: now, failure: stored },
        })
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The stored failure, or null when there is none or this release cannot read it. */
function readFailure(value: unknown): SourceSyncFailure | null {
  if (!isRecord(value) || value['version'] !== STATE_VERSION) return null
  const { reason, message, revision } = value
  if (typeof reason !== 'string' || typeof message !== 'string') return null
  return {
    reason: reason as SourceSyncFailure['reason'],
    message,
    revision: typeof revision === 'string' ? revision : null,
  }
}

/** The stored refusals; an unreadable document reads as none, and the next sync rewrites it. */
function readRefused(value: unknown): readonly RefusedSourceFile[] {
  if (!isRecord(value) || value['version'] !== STATE_VERSION || !Array.isArray(value['files'])) {
    return []
  }
  return value['files'] as RefusedSourceFile[]
}
