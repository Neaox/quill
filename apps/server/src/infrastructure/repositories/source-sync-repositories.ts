import { and, eq, inArray, lt, sql } from 'drizzle-orm'

import type {
  BrokenSourceLink,
  RefusedSourceFile,
  SourceAssetHistoryRepository,
  SourceAssetRepository,
  SourceAssetRow,
  SourceLayoutRecord,
  SourcePathMapRepository,
  SourcePathRow,
  SourceSyncFailure,
  SourceSyncStateRepository,
  SourceSyncStateRow,
  SourceWebhookDeliveryRepository,
} from '@quill/application'
import type { DocumentId, WorkspaceId } from '@quill/domain'

import {
  sourceAssetHolders,
  sourceAssets,
  sourceImageReferences,
  sourcePathMap,
  sourceSyncState,
  sourceWebhookDeliveries,
} from '../db/schema.ts'
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
        order: row.frontMatterOrder,
      }))
    },

    async put(row: SourcePathRow, now: Date): Promise<void> {
      const values = {
        documentId: row.documentId,
        archivedAt: row.archivedAt,
        frontMatterOrder: row.order,
        updatedAt: now,
      }
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

/** Who may see a repository asset: where it was held, and which pages pointed there (ADR-061). */
export function createSourceAssetHistoryRepository(
  db: DrizzleClient,
): SourceAssetHistoryRepository {
  return {
    async recordHeld(workspaceId: WorkspaceId, path: string, attachmentId: string): Promise<void> {
      await db
        .insert(sourceAssetHolders)
        .values({ workspaceId, path, attachmentId })
        .onConflictDoNothing()
    },

    async recordShown(
      workspaceId: WorkspaceId,
      documentId: DocumentId,
      paths: readonly string[],
    ): Promise<void> {
      if (paths.length === 0) return
      await db
        .insert(sourceImageReferences)
        .values(paths.map((path) => ({ workspaceId, documentId, path })))
        .onConflictDoNothing()
    },

    async listDocumentsShowing(attachmentId: string): Promise<readonly DocumentId[]> {
      const rows = await db
        .selectDistinct({ documentId: sourceImageReferences.documentId })
        .from(sourceAssetHolders)
        .innerJoin(
          sourceImageReferences,
          and(
            eq(sourceImageReferences.workspaceId, sourceAssetHolders.workspaceId),
            eq(sourceImageReferences.path, sourceAssetHolders.path),
          ),
        )
        .where(eq(sourceAssetHolders.attachmentId, attachmentId))
      return rows.map((row) => row.documentId as DocumentId)
    },
  }
}

function toAssetRow(row: typeof sourceAssets.$inferSelect): SourceAssetRow {
  return {
    workspaceId: row.workspaceId as WorkspaceId,
    path: row.path,
    attachmentId: row.attachmentId,
    fileId: row.fileId,
  }
}

/** Which attachment each of a sourced workspace's assets holds (ADR-061). */
export function createSourceAssetRepository(db: DrizzleClient): SourceAssetRepository {
  return {
    async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourceAssetRow[]> {
      const rows = await db
        .select()
        .from(sourceAssets)
        .where(eq(sourceAssets.workspaceId, workspaceId))
      return rows.map(toAssetRow)
    },

    async listByPaths(
      workspaceId: WorkspaceId,
      paths: readonly string[],
    ): Promise<readonly SourceAssetRow[]> {
      if (paths.length === 0) return []
      const rows = await db
        .select()
        .from(sourceAssets)
        .where(
          and(eq(sourceAssets.workspaceId, workspaceId), inArray(sourceAssets.path, [...paths])),
        )
      return rows.map(toAssetRow)
    },

    async put(row: SourceAssetRow, now: Date): Promise<void> {
      const values = { attachmentId: row.attachmentId, fileId: row.fileId, updatedAt: now }
      await db
        .insert(sourceAssets)
        .values({ workspaceId: row.workspaceId, path: row.path, ...values })
        .onConflictDoUpdate({
          target: [sourceAssets.workspaceId, sourceAssets.path],
          set: values,
        })
    },

    async remove(workspaceId: WorkspaceId, path: string): Promise<void> {
      await db
        .delete(sourceAssets)
        .where(and(eq(sourceAssets.workspaceId, workspaceId), eq(sourceAssets.path, path)))
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
        layout: readLayout(row.layout),
        brokenLinks: readBrokenLinks(row.brokenLinks),
        failureNotified: row.failureNotified,
      }
    },

    async recordSynced({
      workspaceId,
      revision,
      refused,
      layout,
      brokenLinks,
      now,
    }): Promise<void> {
      const values = {
        lastSyncedRevision: revision,
        lastSyncedAt: now,
        lastAttemptAt: now,
        failure: null,
        refused: { version: STATE_VERSION, files: refused },
        layout: { version: STATE_VERSION, ...layout },
        brokenLinks: brokenLinks === null ? null : { version: STATE_VERSION, links: brokenLinks },
        // A sync that finished ends the failure; the next one is told again.
        failureNotified: null,
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

    /** One conditional update, so of two racing deliveries only one sees it change. */
    async recordFailureNotified({ workspaceId, key }): Promise<boolean> {
      const changed = await db
        .update(sourceSyncState)
        .set({ failureNotified: key })
        .where(
          and(
            eq(sourceSyncState.workspaceId, workspaceId),
            sql`${sourceSyncState.failureNotified} IS DISTINCT FROM ${key}`,
          ),
        )
        .returning({ workspaceId: sourceSyncState.workspaceId })
      return changed.length > 0
    },
  }
}

export function createSourceWebhookDeliveryRepository(
  db: DrizzleClient,
): SourceWebhookDeliveryRepository {
  return {
    async record({ workspaceId, deliveryId, now }): Promise<boolean> {
      const written = await db
        .insert(sourceWebhookDeliveries)
        .values({ workspaceId, deliveryId, receivedAt: now })
        .onConflictDoNothing()
        .returning({ deliveryId: sourceWebhookDeliveries.deliveryId })
      return written.length > 0
    },

    async deleteReceivedBefore(cutoff: Date): Promise<number> {
      const gone = await db
        .delete(sourceWebhookDeliveries)
        .where(lt(sourceWebhookDeliveries.receivedAt, cutoff))
        .returning({ deliveryId: sourceWebhookDeliveries.deliveryId })
      return gone.length
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

/**
 * The stored layout; an absent or unreadable one reads as unknown, which
 * re-plans the tree at the next sync and records it again.
 */
function readLayout(value: unknown): SourceLayoutRecord | null {
  if (!isRecord(value) || value['version'] !== STATE_VERSION) return null
  const { origin, fingerprint, collectionIds, unknownKeys } = value
  if (
    (origin !== 'manifest' && origin !== 'settings') ||
    typeof fingerprint !== 'string' ||
    !Array.isArray(collectionIds) ||
    !Array.isArray(unknownKeys)
  ) {
    return null
  }
  return {
    origin,
    fingerprint,
    collectionIds: collectionIds.filter((id) => typeof id === 'string'),
    unknownKeys: unknownKeys.filter(isRecord).map(({ key, line }) => ({
      key: String(key),
      line: typeof line === 'number' ? line : null,
    })),
  }
}

/**
 * The stored broken links; an absent or unreadable document reads as
 * unchecked, so the next sync checks every document and records them again.
 */
function readBrokenLinks(value: unknown): readonly BrokenSourceLink[] | null {
  if (!isRecord(value) || value['version'] !== STATE_VERSION || !Array.isArray(value['links'])) {
    return null
  }
  return value['links'].filter(
    (link): link is BrokenSourceLink =>
      isRecord(link) &&
      typeof link['path'] === 'string' &&
      typeof link['url'] === 'string' &&
      typeof link['revision'] === 'string',
  )
}

/** The stored refusals; an unreadable document reads as none, and the next sync rewrites it. */
function readRefused(value: unknown): readonly RefusedSourceFile[] {
  if (!isRecord(value) || value['version'] !== STATE_VERSION || !Array.isArray(value['files'])) {
    return []
  }
  return value['files'] as RefusedSourceFile[]
}
