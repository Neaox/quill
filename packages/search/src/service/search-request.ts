import type { WorkspaceId } from '@quill/domain'

import type { VisibilityFilter } from '../visibility/visibility-filter.ts'

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
  readonly limit?: number
  readonly cursor?: string
}
