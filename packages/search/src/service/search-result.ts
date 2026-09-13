import type { DocumentId, WorkspaceId } from '@quill/domain'

import type { Snippet } from '../snippet/snippet.ts'

/** One matching document, with its snippet built and ready to render. */
export interface SearchServiceHit {
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly snippet: Snippet
  readonly score: number
}

/** One other workspace's matches, offered as a group of suggestions. */
export interface WorkspaceHits {
  readonly workspaceId: WorkspaceId
  readonly hits: readonly SearchServiceHit[]
}

/**
 * The shape `SearchService.search` returns (quill-plan.md §15): matches in
 * the request's current workspace first, then every other matching
 * workspace as its own grouped, relevance-ordered suggestion list — never
 * one flat list a reader has to sort out by workspace themselves. `current`
 * is empty when the request carries no `currentWorkspaceId`.
 */
export interface SearchServiceResults {
  readonly current: readonly SearchServiceHit[]
  readonly elsewhere: readonly WorkspaceHits[]
  readonly nextCursor?: string
}
