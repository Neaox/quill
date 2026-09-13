/**
 * The Git vocabulary this package is built from, for the few tools that have to
 * speak it.
 *
 * Nothing in the application, the server, or the web app may import this entry:
 * rule 9 of `AGENTS.md` says repositories, trees, refs, and commits stop at the
 * content store. It exists for maintenance code that reads a repository as a
 * repository — rebuilding the Postgres revisions index from commit trailers
 * (ADR-014), importing an external repository, or a diagnostic that has to
 * explain what is actually on the disk.
 */

export { DEFAULT_REF, DEFAULT_SCAN_LIMIT } from './git-content-store.ts'
export {
  CHANGE_NOTE_TRAILER,
  DOCUMENT_ID_TRAILER,
  PRODUCT_EMAIL,
  PRODUCT_NAME,
} from './branding.ts'
export { buildCommitMessage, type CommitMessage } from './commit-message.ts'
export { changedDocumentIds, toRevisionSummary, walkCommits } from './commit-walk.ts'
export type { WalkedCommit } from './commit-walk.ts'
export { frontMatterField, readDocumentId, readTitle } from './document-front-matter.ts'
export { DocumentIndex, type DocumentLocation, type TreeDocuments } from './document-index.ts'
export { GitRepository } from './git/git-repository.ts'
export {
  hashObject,
  hashSerialised,
  isObjectId,
  parseObject,
  serialiseObject,
  type GitObject,
  type GitObjectType,
} from './git/objects.ts'
export {
  parseContentPath,
  resolvePath,
  setPath,
  walkTree,
  type ContentPath,
} from './git/tree-path.ts'
export { parseTrailers, trailerValues, type Trailer } from './git/trailers.ts'
export { OURS_LABEL, THEIRS_LABEL, threeWayMerge, type ThreeWayMerge } from './three-way-merge.ts'
export { DEFAULT_CONTEXT, NO_NEWLINE, unifiedDiff, type UnifiedDiff } from './unified-diff.ts'
