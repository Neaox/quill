import { and, desc, eq } from 'drizzle-orm'

import type {
  ReferenceKind,
  ReferenceSnapshotRepository,
  ReferenceSnapshotRow,
} from '@quill/application'
import type { WorkspaceId } from '@quill/domain'

import { referenceSnapshots } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/** The table's CHECK constraint admits only these two, so a third value cannot be stored. */
function toKind(value: string): ReferenceKind {
  return value === 'schema' ? 'schema' : 'code'
}

function toRow(row: typeof referenceSnapshots.$inferSelect): ReferenceSnapshotRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId as WorkspaceId,
    kind: toKind(row.kind),
    sourceCommit: row.sourceCommit,
    capturedAt: row.capturedAt,
    artifactHash: row.artifactHash,
    artifactSize: row.artifactSize,
    artifactVersion: row.artifactVersion,
    symbolCount: row.symbolCount,
    tableCount: row.tableCount,
    createdAt: row.createdAt,
  }
}

/**
 * The code and schema snapshots a workspace's reference index serves
 * (ADR-065). The artifact bytes live in the blob store; this table is the
 * provenance and the recency a page reads before it fetches anything.
 */
export function createReferenceSnapshotRepository(db: DrizzleClient): ReferenceSnapshotRepository {
  return {
    async insert(row): Promise<void> {
      await db.insert(referenceSnapshots).values({
        id: row.id,
        workspaceId: row.workspaceId,
        kind: row.kind,
        sourceCommit: row.sourceCommit,
        capturedAt: row.capturedAt,
        artifactHash: row.artifactHash,
        artifactSize: row.artifactSize,
        artifactVersion: row.artifactVersion,
        symbolCount: row.symbolCount,
        tableCount: row.tableCount,
        createdAt: row.createdAt,
      })
    },

    async findById(id: string): Promise<ReferenceSnapshotRow | null> {
      const [row] = await db
        .select()
        .from(referenceSnapshots)
        .where(eq(referenceSnapshots.id, id))
        .limit(1)
      return row === undefined ? null : toRow(row)
    },

    async latest(
      workspaceId: WorkspaceId,
      kind: ReferenceKind,
    ): Promise<ReferenceSnapshotRow | null> {
      const [row] = await db
        .select()
        .from(referenceSnapshots)
        .where(
          and(eq(referenceSnapshots.workspaceId, workspaceId), eq(referenceSnapshots.kind, kind)),
        )
        .orderBy(desc(referenceSnapshots.capturedAt), desc(referenceSnapshots.createdAt))
        .limit(1)
      return row === undefined ? null : toRow(row)
    },

    async list(
      workspaceId: WorkspaceId,
      kind: ReferenceKind,
      limit: number,
    ): Promise<readonly ReferenceSnapshotRow[]> {
      const rows = await db
        .select()
        .from(referenceSnapshots)
        .where(
          and(eq(referenceSnapshots.workspaceId, workspaceId), eq(referenceSnapshots.kind, kind)),
        )
        .orderBy(desc(referenceSnapshots.capturedAt), desc(referenceSnapshots.createdAt))
        .limit(limit)
      return rows.map(toRow)
    },
  }
}
