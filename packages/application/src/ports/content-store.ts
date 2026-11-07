import type { DocumentId, RevisionId, WorkspaceId } from '@quill/domain'

/**
 * The content store port (ADR-014, ADR-015).
 *
 * This is the whole vocabulary the application layer uses for published
 * document content: documents, revisions, diffs, and a tree. Repositories,
 * trees, refs, and commits never appear above this interface. Every method
 * is scoped to a workspace because a workspace is the unit of storage and of
 * remote sync.
 */

export interface ContentAuthor {
  readonly name: string
  readonly email: string
}

/** A published document as stored: its Markdown source and where it lives. */
export interface DocumentSource {
  readonly documentId: DocumentId
  readonly path: string
  readonly markdown: string
  readonly revision: RevisionId
}

/**
 * One publish. `write` creates or replaces a document at `path`; `move`
 * changes its path (and may change content); `delete` removes it. A bulk
 * operation is a single publish with several changes and one revision.
 */
export type ContentChange =
  | {
      readonly kind: 'write'
      readonly documentId: DocumentId
      readonly path: string
      readonly markdown: string
    }
  | {
      readonly kind: 'move'
      readonly documentId: DocumentId
      readonly fromPath: string
      readonly toPath: string
      readonly markdown?: string
    }
  | {
      readonly kind: 'delete'
      readonly documentId: DocumentId
      readonly path: string
    }

export interface PublishRequest {
  readonly workspaceId: WorkspaceId
  readonly changes: readonly ContentChange[]
  readonly author: ContentAuthor
  /** Single line; newlines are folded to spaces before it becomes a trailer. */
  readonly changeNote?: string
  /** Generated when absent, from the changed documents' titles or paths. */
  readonly summary?: string
  /**
   * The revision the caller's content is based on, or null for a workspace
   * with no revisions yet. A stale base triggers a three-way merge.
   */
  readonly base: RevisionId | null
  /**
   * When the change was made, for a revision replayed from a read-only external
   * source (ADR-061): the source revision's own time. Absent, the revision is
   * stamped with the store's clock. Only the sync job sets it; see
   * {@link checkSourceStamp} for what the store accepts.
   */
  readonly authoredAt?: Date
  /**
   * The external source revision this publish replays (ADR-061): an opaque id,
   * recorded on the revision and in the revisions index so a replay can resume
   * and a page can name what it was rendered from. Only the sync job sets it.
   */
  readonly sourceRevision?: string
}

/** How far ahead of the store's clock `authoredAt` may be: forges' clocks drift. */
export const AUTHORED_AT_MAX_SKEW_MS = 5 * 60 * 1000

/** The longest source revision id accepted; a SHA-256 commit id is 64 characters. */
export const SOURCE_REVISION_MAX_LENGTH = 128

/** Visible ASCII only, so the id is safe as a single-line trailer and in a log. */
const SOURCE_REVISION_PATTERN = new RegExp(`^[\\x21-\\x7e]{1,${SOURCE_REVISION_MAX_LENGTH}}$`)

export type SourceStampProblem =
  | 'authored-at-invalid'
  | 'authored-at-in-future'
  | 'source-revision-invalid'

/**
 * Why a publish's source stamp cannot be stored, or null when it can (ADR-061).
 *
 * A publish without `authoredAt` or `sourceRevision` always passes, so a
 * native publish is unaffected. The store refuses a stamp that fails; the sync
 * job checks first, because what it is given comes from someone else's
 * repository.
 */
export function checkSourceStamp(
  request: Pick<PublishRequest, 'authoredAt' | 'sourceRevision'>,
  now: Date,
): SourceStampProblem | null {
  const { authoredAt, sourceRevision } = request
  if (authoredAt !== undefined) {
    if (!Number.isFinite(authoredAt.getTime())) return 'authored-at-invalid'
    if (authoredAt.getTime() > now.getTime() + AUTHORED_AT_MAX_SKEW_MS) {
      return 'authored-at-in-future'
    }
  }
  if (sourceRevision !== undefined && !SOURCE_REVISION_PATTERN.test(sourceRevision)) {
    return 'source-revision-invalid'
  }
  return null
}

export interface MergeConflict {
  readonly documentId: DocumentId
  readonly path: string
  /** The caller's content, theirs (the current revision's), and the common base. */
  readonly ours: string
  readonly theirs: string
  readonly base: string
  /** Merged text with conflict markers, for a merge view. */
  readonly conflicted: string
}

export type PublishResult =
  | { readonly kind: 'published'; readonly revision: RevisionId }
  | {
      readonly kind: 'merge-required'
      readonly current: RevisionId
      readonly conflicts: readonly MergeConflict[]
    }

export interface RevisionSummary {
  readonly revision: RevisionId
  readonly author: ContentAuthor
  readonly timestamp: Date
  readonly summary: string
  readonly changeNote?: string
  readonly documentIds: readonly DocumentId[]
  /** The external source revision this revision replays (ADR-061); absent for a native one. */
  readonly sourceRevision?: string
}

export interface Page {
  /** Mandatory: history is O(total revisions) without an index (ADR-014). */
  readonly limit: number
  readonly cursor?: string
}

export interface ContentDiff {
  readonly documentId: DocumentId
  readonly from: RevisionId | null
  readonly to: RevisionId
  /** Unified diff of the Markdown source. */
  readonly unified: string
  readonly added: number
  readonly removed: number
}

export interface TreeEntry {
  readonly path: string
  readonly kind: 'document' | 'asset' | 'other'
  readonly documentId?: DocumentId
}

/**
 * A file in the tree that is not a document: `.quill/organisation.yaml` and
 * the workspace settings beside it (ADR-034), and the `.quill/` files
 * ADR-014's on-disk layout already shows.
 *
 * These are addressed by path rather than by id, which is not a breach of
 * rule 8: a *document* is its id, and these are not documents. They carry no
 * front matter, so the store cannot find them by identity at all.
 */
export interface ContentFile {
  readonly path: string
  readonly text: string
  readonly revision: RevisionId
}

export interface PutFileRequest {
  readonly workspaceId: WorkspaceId
  readonly path: string
  readonly text: string
  /**
   * The exact text the caller read, or null when it expects no file there.
   * This is the compare-and-swap: the write lands only while the file still
   * says what the caller based it on.
   */
  readonly expected: string | null
  readonly author: ContentAuthor
  /** Generated from the path when absent. */
  readonly summary?: string
  /** Single line; newlines are folded to spaces before it becomes a trailer. */
  readonly changeNote?: string
}

export type PutFileResult =
  | { readonly kind: 'published'; readonly revision: RevisionId }
  /** Somebody else wrote this file first; `current` is what it says now. */
  | { readonly kind: 'stale'; readonly current: ContentFile | null }

export interface ContentStore {
  read(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
    revision?: RevisionId,
  ): Promise<DocumentSource | null>
  publish(request: PublishRequest): Promise<PublishResult>
  history(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
    page: Page,
  ): Promise<readonly RevisionSummary[]>
  diff(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
    from: RevisionId | null,
    to: RevisionId,
  ): Promise<ContentDiff>
  listTree(workspaceId: WorkspaceId, revision?: RevisionId): Promise<readonly TreeEntry[]>
  /** The current revision of a workspace, or null before its first publish. */
  head(workspaceId: WorkspaceId): Promise<RevisionId | null>
  /** One non-document file by path, or null when the tree has none there. */
  readFile(
    workspaceId: WorkspaceId,
    path: string,
    revision?: RevisionId,
  ): Promise<ContentFile | null>
  /**
   * Write one non-document file, refusing rather than merging when it has
   * changed underneath (ADR-034).
   *
   * `publish` is the write for documents, and it three-way merges a stale
   * base because two authors editing one document usually mean to keep both
   * edits. A settings file is not that: it is written whole, by a form, and
   * blending two administrators' versions of it would produce a policy
   * neither of them chose. So this is the same commit and the same ref
   * compare-and-swap, with the file's own contents as the expected value.
   */
  putFile(request: PutFileRequest): Promise<PutFileResult>
}
