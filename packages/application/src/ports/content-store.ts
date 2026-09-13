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
}
