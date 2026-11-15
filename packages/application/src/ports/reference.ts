import type { WorkspaceId } from '@quill/domain'

/**
 * A workspace's reference index is built from two artifacts (ADR-065): the
 * code index produced by the project's own toolchain, and the schema the
 * database actually holds. Each ingestion is a snapshot, kept with the source
 * commit and the instant it was captured, so a page can say how old its facts
 * are and a reader can compare two.
 *
 * The artifact's bytes live in the blob store, addressed by their SHA-256;
 * this row is the provenance. Two snapshots of identical bytes share one
 * object, and deleting a row never deletes an object that another row uses.
 */

export type ReferenceKind = 'code' | 'schema'

export const REFERENCE_KINDS: readonly ReferenceKind[] = ['code', 'schema']

export interface ReferenceSnapshotRow {
  readonly id: string
  readonly workspaceId: WorkspaceId
  readonly kind: ReferenceKind
  /** The commit the artifact was produced from. */
  readonly sourceCommit: string
  /** When the producer read the source, not when this row was written. */
  readonly capturedAt: Date
  /** Lower-case hex SHA-256 of the artifact's bytes. */
  readonly artifactHash: string
  readonly artifactSize: number
  /** The artifact's own format version, so a reader dispatches before parsing. */
  readonly artifactVersion: number
  /** Symbols in a code artifact; 0 in a schema artifact. */
  readonly symbolCount: number
  /** Tables in a schema artifact; 0 in a code artifact. */
  readonly tableCount: number
  readonly createdAt: Date
}

export interface ReferenceSnapshotRepository {
  insert(row: ReferenceSnapshotRow): Promise<void>
  findById(id: string): Promise<ReferenceSnapshotRow | null>
  /**
   * The most recent snapshot of one kind, by capture time and then write
   * time: what the reference surface serves. Null before the first ingestion.
   */
  latest(workspaceId: WorkspaceId, kind: ReferenceKind): Promise<ReferenceSnapshotRow | null>
  /** Newest first, at most `limit`: the history a stale page names. */
  list(
    workspaceId: WorkspaceId,
    kind: ReferenceKind,
    limit: number,
  ): Promise<readonly ReferenceSnapshotRow[]>
}
