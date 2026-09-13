import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { CreatedShareLink, ShareLinkList, ShareLinkScope } from './types.ts'

/**
 * Managing the links into a document
 * (`docs/architecture/api-contract-share-links.md`, plan section 14).
 *
 * This is the *ordinary* half of share links: a session, `manage` on the
 * document, and the platform's error envelope. The other half — reading
 * through a link, with no session at all — is deliberately a module of its
 * own (`share-reading.ts`), because the two have almost nothing in common and
 * nothing in the signed-in world should be reachable from that one.
 *
 * Three writes, one list, and one rule: the list is the record of what doors
 * are open, so a create and a revoke both invalidate it rather than patching
 * a row into it. The server decides a link's `revokedAt` and `lastUsedAt`,
 * and an optimistic row here would be this module guessing at both.
 */

/** The list a create or a revoke makes stale. */
function invalidateShareLinks(queryClient: QueryClient, documentId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.shareLinks(documentId) })
}

export function shareLinksQueryOptions(client: ApiClient, documentId: string) {
  return {
    queryKey: queryKeys.shareLinks(documentId),
    queryFn: () =>
      request<ShareLinkList>(
        client.GET('/api/documents/{id}/share-links', { params: { path: { id: documentId } } }),
      ),
  }
}

/**
 * The document's links. Fetched only while the dialog that shows them is
 * open: the route needs `manage`, so asking for it on every reading page
 * would be a `403` in the console of everyone who cannot manage the document.
 */
export function useShareLinks(documentId: string, options: { readonly enabled?: boolean } = {}) {
  const client = useApiClient()
  return useQuery({
    ...shareLinksQueryOptions(client, documentId),
    enabled: options.enabled ?? true,
  })
}

export interface CreateShareLinkInput {
  readonly documentId: string
  readonly scope: ShareLinkScope
  /**
   * When the link stops working, as an ISO date-time; `null` for a link that
   * never expires, which is what the route means by an omitted value.
   */
  readonly expiresAt: string | null
}

/**
 * Creates a link.
 *
 * `role` is not a parameter: view is the only role this release carries, the
 * server answers `422 share_link_role_unavailable` for anything else, and a
 * dialog that cannot offer a choice should not send one (plan section 14 —
 * comment and edit links arrive in M7).
 *
 * The resolved value carries the raw token, which exists nowhere else and
 * will never be answered again. It is returned rather than cached, so it
 * lives only as long as the dialog that shows it.
 */
export function useCreateShareLink() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, scope, expiresAt }: CreateShareLinkInput) =>
      request<CreatedShareLink>(
        client.POST('/api/documents/{id}/share-links', {
          params: { path: { id: documentId } },
          body: { scope, expiresAt },
        }),
      ),
    onSuccess: (_created, { documentId }) => {
      invalidateShareLinks(queryClient, documentId)
    },
  })
}

export interface RevokeShareLinkInput {
  readonly shareLinkId: string
  /** Known by the caller; the `204` carries no body to read it from. */
  readonly documentId: string
}

/** Revokes a link. Idempotent on the server: revoking twice answers `204` twice. */
export function useRevokeShareLink() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ shareLinkId }: RevokeShareLinkInput) =>
      request<void>(
        client.DELETE('/api/share-links/{id}', { params: { path: { id: shareLinkId } } }),
      ),
    onSuccess: (_result, { documentId }) => {
      invalidateShareLinks(queryClient, documentId)
    },
  })
}
