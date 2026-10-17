import type { DocumentId, UserId, WorkspaceId } from '@quill/domain'

/**
 * What a person has opened, as the person's own record (ADR-053).
 *
 * One row per person and document. It is read only by that person, through
 * their own routes: nothing here aggregates across people, and no method takes
 * a document id without a user id beside it.
 */

export interface DocumentViewRow {
  readonly userId: UserId
  readonly documentId: DocumentId
  /** Where the document was when it was opened, so a workspace's engagement is one grouped read. */
  readonly workspaceId: WorkspaceId
  readonly lastViewedAt: Date
  readonly views: number
}

/** A person's views in one workspace, summed. */
export interface WorkspaceViews {
  readonly workspaceId: WorkspaceId
  readonly views: number
}

export interface DocumentViewRepository {
  /**
   * Records that the person opened the document, unless they already did at or
   * after `debounceBefore`: the row is then left exactly as it was, so a
   * document reloaded in a loop costs one write per window rather than one per
   * read. Answers whether a write happened.
   */
  touch(input: {
    readonly userId: UserId
    readonly documentId: DocumentId
    readonly workspaceId: WorkspaceId
    readonly now: Date
    readonly debounceBefore: Date
  }): Promise<boolean>
  /** The person's most recently opened documents since `since`, newest first, cut at `limit`. */
  listRecent(input: {
    readonly userId: UserId
    readonly since: Date
    readonly limit: number
  }): Promise<readonly DocumentViewRow[]>
  /** The person's views since `since`, summed per workspace: one row per workspace they opened anything in. */
  sumByWorkspace(input: {
    readonly userId: UserId
    readonly since: Date
  }): Promise<readonly WorkspaceViews[]>
  /** Forgets everything the person has opened. Answers how many rows went. */
  deleteForUser(userId: UserId): Promise<number>
  /** Removes every row last touched before `cutoff`, for every person. Answers how many went. */
  deleteOlderThan(cutoff: Date): Promise<number>
}
