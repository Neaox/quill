import type { ContentAuthor } from './content-store.ts'

/**
 * A repository Quill reads documents from and never writes (ADR-061).
 *
 * This is the whole vocabulary the sync job uses for an external source:
 * revisions, the files at a revision, and the changes between two revisions.
 * Commits, trees, refs, and object stores never appear above it (rule 9 of
 * `AGENTS.md`); the adapter in `@quill/content-store` speaks them. One
 * instance reads one branch of one remote, limited to the paths the source
 * was configured with: nothing outside those paths is listed, compared, or
 * read, and no file contents from outside them ever reach the instance.
 */

/** An opaque revision of the source. Equal ids are the same revision. */
export type SourceRevisionId = string

/** An opaque id of a file's contents. Equal ids are byte-for-byte equal contents. */
export type SourceFileId = string

/** One revision on the branch's main line: the change that reached the branch. */
export interface SourceRevision {
  readonly id: SourceRevisionId
  /** Who wrote the change, as the source records it. A name, never an account. */
  readonly author: ContentAuthor
  readonly authoredAt: Date
  /** When the change reached the branch. */
  readonly committedAt: Date
  /** The first paragraph of the revision's message, on one line. */
  readonly subject: string
}

export interface SourceFile {
  readonly path: string
  readonly fileId: SourceFileId
  /**
   * A symbolic link is a file whose contents are the path it points to. It is
   * never followed, so it cannot reach outside the source.
   */
  readonly kind: 'file' | 'symbolic-link'
}

/** How the files under the source's paths differ between two revisions. */
export type SourceChange =
  | { readonly kind: 'added'; readonly file: SourceFile }
  | { readonly kind: 'modified'; readonly file: SourceFile }
  | { readonly kind: 'removed'; readonly path: string }
  /**
   * A file that moved, by the source's own rename detection. A file that
   * moves in from outside the source's paths is `added`: telling would need
   * the contents of a file the instance does not hold.
   */
  | { readonly kind: 'renamed'; readonly fromPath: string; readonly file: SourceFile }

export type SourceFileContent =
  | { readonly kind: 'content'; readonly fileId: SourceFileId; readonly bytes: Uint8Array }
  /** Larger than the adapter's per-file cap. Its contents were discarded unread. */
  | { readonly kind: 'too-large'; readonly fileId: SourceFileId; readonly size: number }

export interface ExternalSource {
  /** The branch's current revision on the remote, without fetching anything. */
  head(): Promise<SourceRevisionId>
  /**
   * Brings the instance up to the branch's current revision, with the file
   * contents of every revision under the source's paths and nothing else, and
   * returns the revision fetched.
   */
  fetch(): Promise<SourceRevisionId>
  /** The files under the source's paths at a fetched revision. */
  files(revision: SourceRevisionId): AsyncIterable<SourceFile>
  /** File contents by id, in the order asked for. Never read from a working tree. */
  readFiles(fileIds: Iterable<SourceFileId>): AsyncIterable<SourceFileContent>
  /**
   * The revisions on the branch's main line after `since` up to and including
   * `until`, oldest first, that change a file under the source's paths. With
   * `since` null, every such revision from the first. Fails with
   * `history-rewritten` when `since` is not an ancestor of `until`: the branch
   * was rewritten and there is no "after".
   */
  history(since: SourceRevisionId | null, until: SourceRevisionId): AsyncIterable<SourceRevision>
  /** What changed under the source's paths from `from` to `to`; with `from` null, every file is added. */
  changes(from: SourceRevisionId | null, to: SourceRevisionId): AsyncIterable<SourceChange>
}

/** Why an external source could not answer. */
export type ExternalSourceFailure =
  /** The `git` executable is missing, or older than the adapter supports. */
  | 'git-unavailable'
  | 'git-too-old'
  /** The remote is not an `https` URL, or carries credentials in the URL. */
  | 'remote-not-allowed'
  /** The outbound policy (ADR-011) refused the remote's host. */
  | 'blocked-by-outbound-policy'
  /** A configured path is not a plain relative path, or is a glob where globs are refused. */
  | 'invalid-path'
  | 'branch-not-found'
  | 'unknown-revision'
  | 'history-rewritten'
  /** A file id the instance does not hold: a defect, never a reason to fetch it. */
  | 'file-missing'
  | 'timeout'
  | 'output-too-large'
  | 'command-failed'

export class ExternalSourceError extends Error {
  readonly reason: ExternalSourceFailure

  constructor(reason: ExternalSourceFailure, message: string) {
    super(message)
    this.name = 'ExternalSourceError'
    this.reason = reason
  }
}

/**
 * The outbound request policy of ADR-011, asked before a request leaves the
 * instance by something that cannot use the outbound HTTP client itself,
 * such as the `git` CLI.
 *
 * It can check the address the name resolves to now; the process that
 * connects resolves it again, so it cannot rule out DNS rebinding. An
 * instance that needs that guarantee routes the traffic through an egress
 * proxy enforcing the same policy.
 */
export interface OutboundHostPolicy {
  check(url: URL): Promise<OutboundHostVerdict>
}

export type OutboundHostVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string }
