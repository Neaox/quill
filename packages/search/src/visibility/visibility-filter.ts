import type { Principal, WorkspaceId } from '@quill/domain'
import { principalKey } from '@quill/domain'
import type { VisibilityFilter } from '@quill/application/ports'

/**
 * Who is searching, and which workspaces the query may even consider
 * (ADR-010, ADR-012). The shape belongs to the search port
 * (`@quill/application`'s `ports/search-index.ts`), where its contract is
 * written out; this is where one is built.
 *
 * `SearchRequest` (see `../service/search-request.ts`) makes it mandatory
 * rather than optional, so a request cannot be built without saying who is
 * searching and where they may look — see `search-request.test.ts` for the
 * type-level proof.
 */

export type { VisibilityFilter } from '@quill/application/ports'

/** Builds a `VisibilityFilter` from the workspaces and principals a request already resolved, de-duplicating both. */
export function visibilityFilter(
  workspaceIds: Iterable<WorkspaceId>,
  principals: Iterable<Principal>,
): VisibilityFilter {
  const principalKeys = new Set<string>()
  for (const principal of principals) principalKeys.add(principalKey(principal))
  return { workspaceIds: [...new Set(workspaceIds)], principalKeys: [...principalKeys] }
}
