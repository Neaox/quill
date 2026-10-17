import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { CollectionCandidate, PublicMenuTarget } from './types.ts'

/**
 * The two reads the public menu editor makes while somebody builds the menu
 * (`docs/architecture/api-contract-settings.md`, "The public menu"). Both are
 * instance administration, like the menu itself.
 */

export interface MenuTargetIds {
  readonly documents: readonly string[]
  readonly collections: readonly string[]
}

/**
 * What each document and collection the menu names is called now, where it
 * sits, and whether a reader sees it.
 *
 * Keyed by the sorted ids, so reordering the menu asks nothing new, and the
 * previous answer stays on screen while a newly picked target is looked up.
 */
export function publicMenuTargetsQueryOptions(client: ApiClient, ids: MenuTargetIds) {
  const documents = [...ids.documents].toSorted()
  const collections = [...ids.collections].toSorted()
  return {
    queryKey: queryKeys.publicMenuTargets(documents, collections),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      request(
        client.GET('/api/settings/organisation/public-menu/targets', {
          signal,
          params: { query: { document: documents, collection: collections } },
        }),
      ),
    enabled: documents.length + collections.length > 0,
    placeholderData: keepPreviousData,
  }
}

/** Every described target, by id; empty while nothing has been asked. */
export function usePublicMenuTargets(ids: MenuTargetIds) {
  const client = useApiClient()
  const query = useQuery(publicMenuTargetsQueryOptions(client, ids))
  const byId = new Map<string, PublicMenuTarget>(
    (query.data?.targets ?? []).map((target) => [target.id, target]),
  )
  return { byId, isPending: query.isPending && query.fetchStatus !== 'idle', error: query.error }
}

/** How many collections the combobox offers at once. */
const CANDIDATE_LIMIT = 6

/** Collections in any workspace whose name contains what was typed. */
export function useCollectionCandidates(query: string) {
  const client = useApiClient()
  const q = query.trim()
  return useQuery({
    queryKey: queryKeys.collectionCandidates(q),
    queryFn: ({ signal }: { signal: AbortSignal }): Promise<readonly CollectionCandidate[]> =>
      request(
        client.GET('/api/settings/organisation/public-menu/collections', {
          signal,
          params: { query: { q, limit: CANDIDATE_LIMIT } },
        }),
      ).then((answer) => answer.collections),
    enabled: q !== '',
    placeholderData: keepPreviousData,
  })
}
