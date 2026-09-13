import type { Principal, WorkspaceId } from '@quill/domain'
import { principalKey } from '@quill/domain'

/**
 * Who is searching, and which workspaces the query may even consider
 * (ADR-010, ADR-012). Search is the one surface that crosses workspaces
 * (quill-plan.md §15: a result from the caller's current workspace comes
 * first, matches from every other workspace they can read follow as grouped
 * suggestions), so `workspaceIds` is the *set* of every workspace the caller
 * may read at all, not the one they are currently in — that one travels
 * separately, on `SearchRequest.currentWorkspaceId`, because it changes what
 * is preferred, not what is visible.
 *
 * An adapter applies this filter *inside* the index query — never by
 * fetching unfiltered hits and discarding the ones a principal cannot see —
 * because a document the principal cannot read must never surface, not even
 * in a total count or a cursor. `principalKeys` uses the same stable key
 * `principalKey` produces for a permission grant, so a filter can be built
 * directly from the principals a request already resolved, without
 * re-deriving identity.
 *
 * `SearchRequest` (see `../service/search-request.ts`) makes this mandatory
 * rather than optional, so a request cannot be built without saying who is
 * searching and where they may look — see `search-request.test.ts` for the
 * type-level proof.
 */
export interface VisibilityFilter {
  readonly workspaceIds: readonly WorkspaceId[]
  readonly principalKeys: readonly string[]
}

/** Builds a `VisibilityFilter` from the workspaces and principals a request already resolved, de-duplicating both. */
export function visibilityFilter(
  workspaceIds: Iterable<WorkspaceId>,
  principals: Iterable<Principal>,
): VisibilityFilter {
  const principalKeys = new Set<string>()
  for (const principal of principals) principalKeys.add(principalKey(principal))
  return { workspaceIds: [...new Set(workspaceIds)], principalKeys: [...principalKeys] }
}
