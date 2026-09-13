import type { WorkspaceId } from '@quill/domain'

import type { SearchServiceHit, WorkspaceHits } from './search-result.ts'

/**
 * Splits already-scored, already-ordered hits into the current workspace's
 * matches and everything else, grouped by workspace (quill-plan.md §15:
 * "search is the one surface that crosses workspaces").
 *
 * `hits` is assumed to already be in relevance order — the contract
 * `SearchIndex.search` documents — so each group's order falls out of a
 * single pass, and groups are then ordered by their own best (first) hit,
 * which is the same relevance signal applied one level up.
 */
export function groupByWorkspaceAffinity(
  hits: readonly SearchServiceHit[],
  currentWorkspaceId: WorkspaceId | undefined,
): { readonly current: readonly SearchServiceHit[]; readonly elsewhere: readonly WorkspaceHits[] } {
  const current: SearchServiceHit[] = []
  const others = new Map<WorkspaceId, SearchServiceHit[]>()

  for (const hit of hits) {
    if (currentWorkspaceId !== undefined && hit.workspaceId === currentWorkspaceId) {
      current.push(hit)
      continue
    }
    const bucket = others.get(hit.workspaceId)
    if (bucket === undefined) others.set(hit.workspaceId, [hit])
    else bucket.push(hit)
  }

  const elsewhere = [...others.entries()]
    .map(([workspaceId, groupHits]): WorkspaceHits => ({ workspaceId, hits: groupHits }))
    .toSorted((a, b) => bestScore(b) - bestScore(a))

  return { current, elsewhere }
}

/**
 * A group's best (first, per the relevance-order contract) hit's score. A
 * group is only ever created by the loop above with one hit already in it,
 * so it is never empty — `noUncheckedIndexedAccess` cannot see that from the
 * array alone.
 */
function bestScore(group: WorkspaceHits): number {
  return (group.hits[0] as SearchServiceHit).score
}
