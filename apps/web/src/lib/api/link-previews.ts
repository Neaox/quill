import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ApiClient, paths } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { pendingLinksInterval } from './content.ts'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'

/**
 * Link previews for the surfaces that show one link at a time: the hover peek
 * and the editor's link controls (ADR-042). A document's own links arrive
 * already drawn into its body (`content.ts`); these are for a link that is not
 * in a rendered body yet, or is being looked at closely.
 */

type ResolveResponse =
  paths['/api/link-previews/resolve']['post']['responses'][200]['content']['application/json']

/** What the server says about one link: a preview, or why there is none. */
export type LinkPreviewView = ResolveResponse['previews'][number]['view']
export type LinkPreview = Extract<LinkPreviewView, { state: 'ready' }>['preview']

/** What a link the server answered nothing for is: one that cannot be previewed. */
const UNPREVIEWABLE: LinkPreviewView = { state: 'unavailable', reason: 'invalid_url' }

/** Where a stored link preview picture is served from: our own origin, immutable (`routes/link-preview-images.ts`). */
export function linkPreviewImageUrl(image: { readonly hash: string }): string {
  return `/link-previews/images/${image.hash}`
}

export interface UseLinkPreviewOptions {
  /** Whether to ask at all; a peek asks only once the pointer has rested. */
  readonly enabled?: boolean
}

/**
 * One link's preview. Asking is what queues the fetch, so a link nobody has
 * previewed answers `pending` and is looked at again at 2, 4, 8 and 16 seconds
 * (the same backoff a document's pending links use) before giving up.
 *
 * `staleTime` is a minute: a preview changes over days, and a reader moving the
 * pointer across the same link twice should not ask twice.
 */
export function linkPreviewQueryOptions(client: ApiClient, url: string, enabled = true) {
  return queryOptions({
    queryKey: queryKeys.linkPreview(url),
    queryFn: async (): Promise<LinkPreviewView> => {
      const { previews } = await request(
        client.POST('/api/link-previews/resolve', { body: { urls: [url] } }),
      )
      return previews[0]?.view ?? UNPREVIEWABLE
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: (query) =>
      pendingLinksInterval(
        query.state.data?.state === 'pending' ? 1 : 0,
        query.state.dataUpdateCount,
      ),
  })
}

export function useLinkPreview(url: string, { enabled = true }: UseLinkPreviewOptions = {}) {
  const client = useApiClient()
  return useQuery(linkPreviewQueryOptions(client, url, enabled))
}

/**
 * Forces a fresh fetch of one link's page, for an author who knows it changed.
 * The answer is the new view, so it replaces what readers of this link see.
 */
export function useRefreshLinkPreview() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (url: string): Promise<LinkPreviewView> =>
      request(client.POST('/api/link-previews/refresh', { body: { url } })),
    onSuccess: (view, url) => {
      queryClient.setQueryData(queryKeys.linkPreview(url), view)
    },
  })
}
