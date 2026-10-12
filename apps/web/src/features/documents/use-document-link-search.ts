import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import type { DocumentLinkTarget } from '@quill/editor'

import { useApiClient } from '../../lib/api/client-context.tsx'
import { PALETTE_LIMIT, queryTooLong, searchQueryOptions } from '../../lib/api/search.ts'
import type { SearchHit, SearchResults } from '../../lib/api/types.ts'

/**
 * The editor's "Link to document" search: the same request the command
 * palette makes, through the same query cache, so a document found in one is
 * found the same way in the other. Matches in the workspace being written in
 * come first (quill-plan.md §15); each says where it lives, because two
 * documents can share a title.
 */

function target(hit: SearchHit, workspace?: string): DocumentLinkTarget {
  const trail = [...(workspace === undefined ? [] : [workspace]), ...hit.breadcrumb]
  return {
    id: hit.documentId,
    title: hit.title,
    ...(trail.length === 0 ? {} : { context: trail.join(' / ') }),
  }
}

/** Every hit, the current workspace's first, as link targets. */
export function linkTargets(results: SearchResults): readonly DocumentLinkTarget[] {
  return [
    ...results.current.map((hit) => target(hit)),
    ...results.elsewhere.flatMap((group) =>
      group.hits.map((hit) => target(hit, group.workspace.name)),
    ),
  ]
}

export function useDocumentLinkSearch(
  workspaceId: string,
): (query: string, signal: AbortSignal) => Promise<readonly DocumentLinkTarget[]> {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useCallback(
    async (query: string, signal: AbortSignal) => {
      if (query.trim() === '' || queryTooLong(query)) return []
      const options = searchQueryOptions(client, { query, workspaceId, limit: PALETTE_LIMIT })
      const results = await queryClient.fetchQuery({
        queryKey: options.queryKey,
        queryFn: () => options.queryFn({ signal }),
      })
      return linkTargets(results)
    },
    [client, queryClient, workspaceId],
  )
}
