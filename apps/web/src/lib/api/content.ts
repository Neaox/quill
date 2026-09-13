import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { toApiError } from './errors.ts'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type {
  DocumentEnvelope,
  DocumentHistory,
  PublishedContent,
  RenderedDocument,
  RevisionDiff,
} from './types.ts'

/**
 * The read side of the M2 content API: the cached body, the live envelope,
 * the revision list, and the diff between two revisions (ADR-031,
 * `docs/architecture/api-contract-m2.md`).
 */

/**
 * A rendered body, plus the `ETag` the render cache set for it.
 *
 * The tag is kept with the body rather than in a store beside the cache so
 * the two can never disagree: an entry evicted by TanStack Query takes its
 * validator with it, and a 304 can only ever be answered from the entry that
 * produced the tag in the first place.
 */
export interface CachedRenderedDocument {
  readonly body: RenderedDocument
  readonly etag: string | null
}

/**
 * Fetches a rendered body, revalidating with `If-None-Match` when one is
 * already cached.
 *
 * `GET /documents/:id/rendered` tags its reply with the revision plus the
 * render version (ADR-031), so a document that has not been republished
 * answers `304 Not Modified` with no body at all. Returning the cached entry
 * unchanged on a 304 is what makes that saving real: the identical object
 * goes back into the cache, so React re-renders nothing and the highlighting
 * effect below does not run again.
 */
async function fetchRendered(
  client: ApiClient,
  queryClient: QueryClient,
  documentId: string,
  revision: string | undefined,
): Promise<CachedRenderedDocument> {
  const key = queryKeys.rendered(documentId, revision)
  const cached = queryClient.getQueryData<CachedRenderedDocument>(key)

  // Read straight off the client rather than through `request`: a 304 is
  // neither a success nor a failure to it, and the validator this revalidates
  // with lives in a response header rather than in the body.
  const { data, error, response } = await client.GET('/api/documents/{id}/rendered', {
    params: {
      path: { id: documentId },
      ...(revision === undefined ? {} : { query: { revision } }),
    },
    ...(cached?.etag == null ? {} : { headers: { 'If-None-Match': cached.etag } }),
  })

  if (response.status === 304 && cached !== undefined) return cached
  if (!response.ok) throw toApiError(response.status, error)
  if (data === undefined) {
    throw new Error('The server answered a rendered-body request with no body')
  }
  return { body: data, etag: response.headers.get('etag') }
}

/**
 * The rendered body of a document, at its head revision or at a named one.
 *
 * `staleTime: Infinity` is not a guess: the body is a pure function of the
 * Markdown and the renderer (ADR-031), so an entry keyed by an explicit
 * revision can never go stale. The head entry is invalidated by a publish or
 * a restore (`publishing.ts`), which is the only thing that can change it.
 */
export function renderedQueryOptions(
  client: ApiClient,
  queryClient: QueryClient,
  documentId: string,
  revision?: string,
) {
  return {
    queryKey: queryKeys.rendered(documentId, revision),
    queryFn: () => fetchRendered(client, queryClient, documentId, revision),
    staleTime: Number.POSITIVE_INFINITY,
  }
}

export function useRenderedDocument(documentId: string, revision?: string) {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useQuery(renderedQueryOptions(client, queryClient, documentId, revision))
}

/**
 * The live envelope: permissions, the lock holder, the last publish, review
 * status, and health signals (ADR-031).
 *
 * Deliberately *not* cached with the body. It is a property of now, so it is
 * re-read whenever the window regains focus rather than held until something
 * invalidates it.
 */
export function useDocumentEnvelope(documentId: string) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.envelope(documentId),
    queryFn: () =>
      request<DocumentEnvelope>(
        client.GET('/api/documents/{id}/envelope', { params: { path: { id: documentId } } }),
      ),
  })
}

/**
 * A document's published Markdown and front matter.
 *
 * Only the template picker reads this so far: a template *is* an ordinary
 * published document (ADR-029), and its questions live in its front matter,
 * so choosing one means reading the document it is.
 */
export function usePublishedContent(documentId: string | undefined) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.publishedContent(documentId ?? ''),
    queryFn: () => {
      if (documentId === undefined) {
        throw new Error('usePublishedContent: documentId is required once enabled')
      }
      return request<PublishedContent>(
        client.GET('/api/documents/{id}/content', { params: { path: { id: documentId } } }),
      )
    },
    enabled: documentId !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Every revision that touched this document, newest first. */
export function useDocumentHistory(
  documentId: string,
  options: { readonly enabled?: boolean } = {},
) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.history(documentId),
    queryFn: () =>
      request<DocumentHistory>(
        client.GET('/api/documents/{id}/history', { params: { path: { id: documentId } } }),
      ),
    enabled: options.enabled ?? true,
  })
}

export interface DiffRange {
  /** `null` compares against the empty document, which is what the route means by an absent `from`. */
  readonly from: string | null
  readonly to: string
}

/**
 * The unified diff between two revisions. Both revisions are immutable, so
 * the answer is too.
 */
export function useRevisionDiff(documentId: string, range: DiffRange | undefined) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.diff(documentId, range?.from ?? null, range?.to ?? ''),
    queryFn: () => {
      if (range === undefined) {
        throw new Error('useRevisionDiff: a range is required once enabled')
      }
      return request<RevisionDiff>(
        client.GET('/api/documents/{id}/diff', {
          params: {
            path: { id: documentId },
            query: { to: range.to, ...(range.from === null ? {} : { from: range.from }) },
          },
        }),
      )
    },
    enabled: range !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
}
