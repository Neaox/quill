import type {
  DocumentId,
  SourceCommitMessageSetting,
  SourceHistorySetting,
  SourceOutsideLinkSetting,
  UserId,
  WorkspaceId,
} from '@quill/domain'

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
   * The collections the source's files are placed in when the source has no
   * manifest (ADR-061): the manifest decides wherever it is present. A file
   * belongs to the collection with the longest path it lies under; a file
   * under none of them is not read.
   */
  readonly collections: readonly SourceCollection[]
  /** `full` replays every revision; `head` imports only the current one as one revision. */
  readonly history: SourceHistorySetting
  /** `subject` shows each revision's subject as its change note; `none` shows no message. */
  readonly commitMessages: SourceCommitMessageSetting
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
// Persistence: where a sourced workspace reads from
// ---------------------------------------------------------------------------

/**
 * The credential a source is fetched with (ADR-061, ADR-034): an HTTP Basic
 * user name, and the name of the product secret that holds the password or
 * token. The value is read from the secrets store at the moment of each fetch
 * and never stored here.
 */
export interface WorkspaceSourceCredential {
  readonly username: string
  readonly secretName: string
}

/**
 * A sourced workspace's source, as an administrator configured it (ADR-061,
 * "A source is configured on a workspace"). Its presence is what makes the
 * workspace sourced: `WorkspaceRow.origin` is read from it.
 *
 * The remote and branch are where the composition root opens the source; the
 * rest is what the sync job reads as `SourceSettings`.
 */
export interface WorkspaceSourceRow extends SourceSettings, SourceLinkSettings {
  readonly workspaceId: WorkspaceId
  /** An `https` address with no credentials in it. */
  readonly remote: string
  readonly branch: string
  readonly credential: WorkspaceSourceCredential | null
  /**
   * The name of the product secret its push webhook is signed with (ADR-061,
   * ADR-034), or null when it takes no webhook and waits for the daily
   * reconciliation and the check on read.
   */
  readonly webhookSecretName: string | null
  readonly configuredBy: UserId | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * How a sourced document's links to repository files the source does not
 * hold are drawn (ADR-061, "Relative links, resolved at render"): to the
 * forge at the synced commit, or as their words alone.
 */
export interface SourceLinkSettings {
  readonly outsideLinks: SourceOutsideLinkSetting
  /**
   * The forge's address for a file at a commit, with `{commit}` and `{path}`
   * in it. Null to use the one known for the remote's host (GitHub, GitLab,
   * Bitbucket); a remote on any other host without one shows such links as
   * text.
   */
  readonly viewTemplate: string | null
}

export interface WorkspaceSourceRepository {
  find(workspaceId: WorkspaceId): Promise<WorkspaceSourceRow | null>
  /** Every sourced workspace, for the daily reconciliation. */
  listWorkspaceIds(): Promise<readonly WorkspaceId[]>
  /** Writes the workspace's source whole; the first write makes the workspace sourced. */
  put(input: {
    readonly workspaceId: WorkspaceId
    readonly remote: string
    readonly branch: string
    readonly collections: readonly SourceCollection[]
    readonly history: SourceHistorySetting
    readonly commitMessages: SourceCommitMessageSetting
    readonly credential: WorkspaceSourceCredential | null
    readonly outsideLinks: SourceOutsideLinkSetting
    readonly viewTemplate: string | null
    readonly webhookSecretName: string | null
    readonly configuredBy: UserId
    readonly now: Date
  }): Promise<WorkspaceSourceRow>
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
  /**
   * The `order` its front matter gave when it was last read, or null: what
   * the collection's sort keys are projected from (ADR-049). Null for a row
   * written before it was recorded.
   */
  readonly order: number | null
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

// ---------------------------------------------------------------------------
// Persistence: the source's assets
// ---------------------------------------------------------------------------

/**
 * Which attachment a repository asset's path holds at the head (ADR-061,
 * "Repository assets, as content-addressed attachments"): an image or other
 * file under the manifest's `assets` paths, or an image in a collection.
 */
export interface SourceAssetRow {
  readonly workspaceId: WorkspaceId
  readonly path: string
  readonly attachmentId: string
  /** The source's own id for the file's contents, so an unchanged file is not imported again. */
  readonly fileId: string
}

/** The asset map, keyed by `(workspace, path)`. Written only by the sync job. */
export interface SourceAssetRepository {
  listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourceAssetRow[]>
  /** The rows for these paths, in one query. */
  listByPaths(
    workspaceId: WorkspaceId,
    paths: readonly string[],
  ): Promise<readonly SourceAssetRow[]>
  put(row: SourceAssetRow, now: Date): Promise<void>
  remove(workspaceId: WorkspaceId, path: string): Promise<void>
}

/** Why a sync stopped. The source's own reasons, and the job's. */
export type SourceSyncFailureReason =
  | ExternalSourceFailure
  /** Something else wrote the workspace's store while the job was replaying. */
  | 'store-moved'
  /** The store refused what the job asked of it, such as a revision id it cannot record. */
  | 'store-refused'
  /** The manifest at the head does not read; the message names the line. */
  | 'invalid-manifest'
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
  readonly reason:
    | 'too-large'
    | 'not-utf8'
    | 'symbolic-link'
    | 'outside-collections'
    /** An asset whose bytes are not a type an upload may be (ADR-011). */
    | 'type-not-allowed'
    /** An asset whose bytes are not what its file name says. */
    | 'type-mismatch'
    /** An asset with nothing in it. */
    | 'empty'
    /** An image whose container could not be read, so its metadata could not be removed. */
    | 'malformed'
}

/**
 * The layout the workspace was last placed by: whether the manifest or the
 * stored settings decided it, the fingerprint a later sync compares to know
 * the tree must be re-planned, the collections the manifest created (which
 * it retires again when it stops naming them), and the manifest's keys this
 * release does not read, for the source's admin page.
 */
export interface SourceLayoutRecord {
  readonly origin: 'manifest' | 'settings'
  readonly fingerprint: string
  readonly collectionIds: readonly string[]
  readonly unknownKeys: readonly { readonly key: string; readonly line: number | null }[]
}

/**
 * A relative link in a document of the source to a path that is not in the
 * repository at the revision it was checked at (ADR-061): what the source's
 * admin page lists as broken.
 */
export interface BrokenSourceLink {
  /** The document's path in the source. */
  readonly path: string
  /** The link's destination as written. */
  readonly url: string
  /** The source revision at which the path was not there. */
  readonly revision: SourceRevisionId
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
  /** What placed the tree last; null before this was recorded, which re-plans the tree once. */
  readonly layout: SourceLayoutRecord | null
  /**
   * The relative links that lead nowhere in the repository, as the last sync
   * found them; null when no sync has checked them since the documents last
   * changed (a sync stopped part-way, or a state from before they were
   * recorded), which the next sync answers by checking every document.
   */
  readonly brokenLinks: readonly BrokenSourceLink[] | null
  /**
   * The failure the workspace's administrators were last told about, by its
   * key (`sourceFailureKey`), so a failure is told once however many
   * attempts it stops. Cleared by a sync that finishes.
   */
  readonly failureNotified: string | null
}

export interface SourceSyncStateRepository {
  find(workspaceId: WorkspaceId): Promise<SourceSyncStateRow | null>
  /**
   * The workspace now holds `revision` in full. Clears any failure, and which
   * failure was told, and keeps the files refused while getting there.
   */
  recordSynced(input: {
    readonly workspaceId: WorkspaceId
    readonly revision: SourceRevisionId
    readonly refused: readonly RefusedSourceFile[]
    readonly layout: SourceLayoutRecord
    readonly brokenLinks: readonly BrokenSourceLink[] | null
    readonly now: Date
  }): Promise<void>
  /** The attempt stopped. What was synced before it stays as it was. */
  recordFailure(input: {
    readonly workspaceId: WorkspaceId
    readonly failure: SourceSyncFailure
    readonly now: Date
  }): Promise<void>
  /**
   * Records that the administrators were told about the failure with this
   * key. Answers false, changing nothing, when they already were or the
   * workspace has no sync state, so two deliveries racing tell it once.
   */
  recordFailureNotified(input: {
    readonly workspaceId: WorkspaceId
    readonly key: string
  }): Promise<boolean>
}

// ---------------------------------------------------------------------------
// Persistence: push webhook deliveries
// ---------------------------------------------------------------------------

/**
 * The delivery ids of the push webhooks a sourced workspace has accepted
 * (ADR-061, "Freshness"), kept a week so a forge's retry of one delivery asks
 * for one sync.
 */
export interface SourceWebhookDeliveryRepository {
  /** Records a delivery; answers false when it was already recorded. */
  record(input: {
    readonly workspaceId: WorkspaceId
    readonly deliveryId: string
    readonly now: Date
  }): Promise<boolean>
  /** Forgets every delivery received before `cutoff`. Answers how many went. */
  deleteReceivedBefore(cutoff: Date): Promise<number>
}
