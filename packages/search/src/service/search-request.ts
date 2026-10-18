import type { CollectionId, WorkspaceId } from '@quill/domain'

import type { SharedVisibility, VisibilityFilter } from '../visibility/visibility-filter.ts'
import type { FacetName } from './search-index.ts'

/**
 * A boundary the *caller* sets, as opposed to the person typing the query.
 *
 * It is ANDed with whatever the query says, inside the engine's own query, so
 * it narrows what is searched before the page is cut: a surface that is one
 * part of a workspace (a public site is one collection of it) gets a full page
 * of its own matches rather than a short page of whatever survived being
 * filtered afterwards. It can only narrow — a `collection:` the author types
 * is a second condition, never a way out of this one — and it is not
 * permission: the visibility filter still decides what may be read.
 */
export interface SearchScope {
  readonly collectionId: CollectionId
}

/**
 * What `SearchService.search` needs to run a query (ADR-010, quill-plan.md
 * §15). `filter` is required, not optional, so a request cannot be built
 * without saying who is searching — TypeScript refuses a `SearchRequest`
 * missing it at compile time (see `search-request.test.ts`), the same way
 * `resolvePermission` cannot be called without a principal.
 */
export interface SearchRequest {
  readonly queryText: string
  readonly filter: VisibilityFilter

  /**
   * The workspace the caller is currently in, for workspace-affinity
   * ranking (quill-plan.md §15): a match there is preferred over an equally
   * relevant match elsewhere, and matches elsewhere are grouped as
   * suggestions rather than interleaved. Absent means no affinity: nothing
   * is preferred, and every match is grouped as a suggestion.
   */
  readonly currentWorkspaceId?: WorkspaceId
  /** Narrows the search to one part of what the caller may read; see {@link SearchScope}. */
  readonly scope?: SearchScope
  readonly limit?: number
  readonly cursor?: string
  /** Made from `filter`; pass the same one to the facets of this request so visibility is resolved once. */
  readonly visibility?: SharedVisibility
}

/**
 * What `SearchService.facets` needs to count what a query matches: the same
 * text, visibility and scope as the search it refines, so a count is over the
 * set of documents that search pages through.
 */
export interface FacetsRequest {
  readonly queryText: string
  readonly filter: VisibilityFilter
  readonly scope?: SearchScope
  readonly facets: readonly FacetName[]
  /** The most values of `tag` and `status` to return. */
  readonly limit: number
  /** The workspace of the search these refine, so both resolve visibility in the same order and can share it. */
  readonly currentWorkspaceId?: WorkspaceId
  /** Made from `filter`; the same one the search of this request was given. */
  readonly visibility?: SharedVisibility
}
