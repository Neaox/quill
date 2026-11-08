import type { DocumentId, WorkspaceId } from '@quill/domain'

import type { ExternalSource, ExternalSourceFailure, SourceRevisionId } from './external-source.ts'

/**
 * What the sync job of a sourced workspace needs besides the source itself
 * (ADR-061): where its files go, how much history to replay, and whether
 * commit messages are shown. Nothing here names a repository, a branch or a
 * credential; the composition root opened the source with those.
 */

/** A collection of the workspace and the source path it reads: a directory, or one file. */
export interface SourceCollection {
  /** A `CollectionRow` id of the sourced workspace. */
  readonly collectionId: string
  readonly path: string
}

export interface SourceSettings {
  /**
   * The collections the source's files are placed in, as the manifest names
   * them. A file belongs to the collection with the longest path it lies
   * under; a file under none of them is not read.
   */
  readonly collections: readonly SourceCollection[]
  /** `full` replays every revision; `head` imports only the current one as one revision. */
  readonly history: 'full' | 'head'
  /** `subject` shows each revision's subject as its change note; `none` shows no message. */
  readonly commitMessages: 'subject' | 'none'
}

export interface ConnectedSource {
  readonly source: ExternalSource
  readonly settings: SourceSettings
}

/**
 * Opens the external source a workspace reads from (Factory plus Strategy,
 * `XProvider.forWorkspace(id)`): the adapter, its credentials and its cache
 * directory are the composition root's business. Null for a workspace that
 * reads from no source.
 */
export interface ExternalSourceProvider {
  forWorkspace(workspaceId: WorkspaceId): Promise<ConnectedSource | null>
}

/**
 * One sync per source at a time (ADR-061). The lock also guards the source's
 * cache directory, which allows one fetch at a time.
 */
export interface SourceSyncLock {
  /** Runs `work` holding the source's lock, or answers `busy` at once when another holds it. */
  withLock<T>(
    workspaceId: WorkspaceId,
    work: () => Promise<T>,
  ): Promise<{ readonly kind: 'ran'; readonly value: T } | { readonly kind: 'busy' }>
}

// ---------------------------------------------------------------------------
// Persistence: the path map and the source's sync state
// ---------------------------------------------------------------------------

/**
 * One path the sync job has seen and the document id minted for it at first
 * sight (ADR-061, "Identity without front matter"). The id never changes: a
 * rename moves the entry, and a file that leaves the source is archived and
 * comes back under the same id if its path appears again.
 */
export interface SourcePathRow {
  readonly workspaceId: WorkspaceId
  readonly path: string
  readonly documentId: DocumentId
  /** When the file left the source; null while it is there. */
  readonly archivedAt: Date | null
}

/**
 * The path map, keyed by `(workspace, path)`. Written only by the sync job, in
 * the transaction that records the revision that changed it.
 */
export interface SourcePathMapRepository {
  listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourcePathRow[]>
  /** Writes the entry for a path whole, replacing whatever entry the path had. */
  put(row: SourcePathRow, now: Date): Promise<void>
  /** Forgets a path: a rename moved its document elsewhere. */
  remove(workspaceId: WorkspaceId, path: string): Promise<void>
}

/** Why a sync stopped. The source's own reasons, and the job's. */
export type SourceSyncFailureReason =
  | ExternalSourceFailure
  /** Something else wrote the workspace's store while the job was replaying. */
  | 'store-moved'
  /** The store refused what the job asked of it, such as a revision id it cannot record. */
  | 'store-refused'
  /** Anything unforeseen: a database or store failure. */
  | 'unexpected'

export interface SourceSyncFailure {
  readonly reason: SourceSyncFailureReason
  readonly message: string
  /** The source revision being replayed when it stopped; null before replay began. */
  readonly revision: SourceRevisionId | null
}

/** A file the job did not store, and why; the source's admin page lists them. */
export interface RefusedSourceFile {
  readonly path: string
  readonly revision: SourceRevisionId
  readonly reason: 'too-large' | 'not-utf8' | 'symbolic-link' | 'outside-collections'
}

export interface SourceSyncStateRow {
  readonly workspaceId: WorkspaceId
  /** The last source revision the workspace holds in full; null before the first sync. */
  readonly lastSyncedRevision: SourceRevisionId | null
  readonly lastSyncedAt: Date | null
  readonly lastAttemptAt: Date
  /** Why the last attempt stopped, or null when it finished. */
  readonly failure: SourceSyncFailure | null
  /** The files the last revisions replayed did not store. */
  readonly refused: readonly RefusedSourceFile[]
}

export interface SourceSyncStateRepository {
  find(workspaceId: WorkspaceId): Promise<SourceSyncStateRow | null>
  /**
   * The workspace now holds `revision` in full. Clears any failure, and keeps
   * the files refused while getting there.
   */
  recordSynced(input: {
    readonly workspaceId: WorkspaceId
    readonly revision: SourceRevisionId
    readonly refused: readonly RefusedSourceFile[]
    readonly now: Date
  }): Promise<void>
  /** The attempt stopped. What was synced before it stays as it was. */
  recordFailure(input: {
    readonly workspaceId: WorkspaceId
    readonly failure: SourceSyncFailure
    readonly now: Date
  }): Promise<void>
}
