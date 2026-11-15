import type { WorkspaceId } from '@quill/domain'

import type { BlobStore } from '../ports/blob-store.ts'
import type { UnitOfWork } from '../ports/persistence.ts'
import type { ReferenceKind, ReferenceSnapshotRow } from '../ports/reference.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'

/**
 * Ingesting and reading the artifacts behind a workspace's reference index
 * (ADR-065).
 *
 * Ingestion is deliberately one-way: the artifact is produced by the project's
 * own toolchain, validated there, and this module only records where it came
 * from and puts its bytes where a reader can fetch them. Nothing here parses
 * the artifact, which is what keeps the compiler and the database schema out
 * of the application layer.
 */

export interface ReferenceDependencies {
  readonly uow: UnitOfWork
  /** Where the artifact's bytes live, addressed by their SHA-256 (ADR-034). */
  readonly blobStore: BlobStore
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface IngestReferenceCommand {
  readonly workspaceId: WorkspaceId
  readonly kind: ReferenceKind
  /** The commit the producer read. A schema capture names the same commit. */
  readonly sourceCommit: string
  /** When the producer read the source, not when this call runs. */
  readonly capturedAt: Date
  /** The artifact's own format version. */
  readonly artifactVersion: number
  /** Symbols in a code artifact; 0 in a schema artifact. */
  readonly symbolCount: number
  /** Tables in a schema artifact; 0 in a code artifact. */
  readonly tableCount: number
  /** The artifact as JSON, streamed so a large code index is never held whole. */
  readonly artifact: AsyncIterable<Uint8Array>
}

export type IngestReferenceResult =
  | { readonly kind: 'stored'; readonly snapshot: ReferenceSnapshotRow }
  | { readonly kind: 'workspace-not-found'; readonly workspaceId: WorkspaceId }

/**
 * Stores one artifact and the row that names it.
 *
 * The bytes are written before the row, because a row whose object is missing
 * is a snapshot that can only fail to read; an object no row names is the
 * harmless direction, and the store is content-addressed so a later retry
 * reuses it.
 */
export async function ingestReference(
  deps: ReferenceDependencies,
  command: IngestReferenceCommand,
): Promise<IngestReferenceResult> {
  checks(command)

  const workspace = await deps.uow.repos.workspaces.findById(command.workspaceId)
  if (workspace === null) {
    return { kind: 'workspace-not-found', workspaceId: command.workspaceId }
  }

  const artifact = await deps.blobStore.put(command.artifact, 'application/json')
  const snapshot: ReferenceSnapshotRow = {
    id: deps.ids.uuid(),
    workspaceId: command.workspaceId,
    kind: command.kind,
    sourceCommit: command.sourceCommit,
    capturedAt: command.capturedAt,
    artifactHash: artifact.hash,
    artifactSize: artifact.size,
    artifactVersion: command.artifactVersion,
    symbolCount: command.symbolCount,
    tableCount: command.tableCount,
    createdAt: deps.clock.now(),
  }
  await deps.uow.run(async (repos) => {
    await repos.referenceSnapshots.insert(snapshot)
  })
  return { kind: 'stored', snapshot }
}

/** The snapshot the reference surface reads, or null before the first ingestion. */
export async function latestReference(
  deps: { readonly uow: UnitOfWork },
  workspaceId: WorkspaceId,
  kind: ReferenceKind,
): Promise<ReferenceSnapshotRow | null> {
  return deps.uow.repos.referenceSnapshots.latest(workspaceId, kind)
}

/** Newest first, at most `limit`; `limit` is clamped to 1..100. */
export async function listReferenceSnapshots(
  deps: { readonly uow: UnitOfWork },
  workspaceId: WorkspaceId,
  kind: ReferenceKind,
  limit = 20,
): Promise<readonly ReferenceSnapshotRow[]> {
  const bounded = Math.min(100, Math.max(1, Math.trunc(limit)))
  return deps.uow.repos.referenceSnapshots.list(workspaceId, kind, bounded)
}

/**
 * The artifact's bytes, lazily, or `null` when the object is missing.
 *
 * Missing rather than throwing because the row and the object are two stores:
 * a sweep that removed an unreferenced object can race a read, and the page
 * says the snapshot cannot be read instead of failing the whole reference.
 */
export async function openReferenceArtifact(
  deps: { readonly blobStore: BlobStore },
  snapshot: ReferenceSnapshotRow,
): Promise<AsyncIterable<Uint8Array> | null> {
  return deps.blobStore.open(snapshot.artifactHash)
}

function checks(command: IngestReferenceCommand): void {
  if (command.sourceCommit.trim() === '') {
    throw new TypeError('A reference snapshot needs the commit it was produced from')
  }
  if (Number.isNaN(command.capturedAt.getTime())) {
    throw new TypeError('A reference snapshot needs a valid capture time')
  }
  if (!Number.isInteger(command.artifactVersion) || command.artifactVersion < 1) {
    throw new TypeError('A reference artifact version is a positive integer')
  }
  for (const count of [command.symbolCount, command.tableCount]) {
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError('A reference snapshot count is a non-negative integer')
    }
  }
}
