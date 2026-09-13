import { useSuspenseQuery } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { SharedBody, SharedDocument } from './types.ts'

/**
 * Reading through a share link
 * (`docs/architecture/api-contract-share-links.md`).
 *
 * The only unauthenticated, non-public surface the platform has, and the
 * reason it is a module of its own rather than two more functions in
 * `share-links.ts`: nothing here has a session, nothing here may reach a
 * cache entry the signed-in world wrote, and every refusal — an unknown
 * token, an expired or revoked link, a document outside its scope, one with
 * nothing published — is the same `404`. The page therefore never branches on
 * *why*; it has one not-available state, which is the point of the contract.
 *
 * **No credentials.** `createApiClient` sends the session cookie with every
 * other request; these two send none. The server does not read it on these
 * routes — a member holding a link sees the share-link page, exactly as a
 * stranger does — so sending it would be a cookie travelling for no reason,
 * and the `Request` these build is the one place that can be held to it.
 */
const ANONYMOUS = { credentials: 'omit' } as const

/**
 * Fetched once and never refetched while the page is open.
 *
 * Every read of a link is an audited use of it — a row per read, by registered
 * decision (plan section 14; use case 25) — so a background revalidation on
 * window focus would write an audit row for a tab somebody left open. The
 * body is content-addressed besides (ADR-031), so there is nothing to
 * revalidate: a reader who wants the latest reloads the page.
 */
const READ_ONCE = { staleTime: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false } as const

/** The link's target: the link's own terms, the document, its body, and the navigation. */
export function sharedDocumentQueryOptions(client: ApiClient, token: string) {
  return {
    queryKey: queryKeys.sharedDocument(token),
    queryFn: () =>
      request<SharedDocument>(
        client.GET('/api/share/{token}', { params: { path: { token } }, ...ANONYMOUS }),
      ),
    ...READ_ONCE,
  }
}

/**
 * The link's target, from the entry the route's loader already awaited.
 *
 * `useSuspenseQuery`, not `useQuery`: the loader resolved the token before
 * the page was rendered, and a page that cannot be drawn without the document
 * has no pending branch worth writing (ADR-013). A failed load never reaches
 * here at all — it is the one not-available page.
 */
export function useLoadedSharedDocument(token: string) {
  const client = useApiClient()
  return useSuspenseQuery(sharedDocumentQueryOptions(client, token))
}

/**
 * One document inside a subtree link, by the reference in the address
 * (ADR-035): a UUID, a short key, or the title words in front of one, exactly
 * as `/api/documents/:id` accepts.
 */
export function sharedBodyQueryOptions(client: ApiClient, token: string, reference: string) {
  return {
    queryKey: queryKeys.sharedBody(token, reference),
    queryFn: () =>
      request<SharedBody>(
        client.GET('/api/share/{token}/documents/{id}/rendered', {
          params: { path: { token, id: reference } },
          ...ANONYMOUS,
        }),
      ),
    ...READ_ONCE,
  }
}

/** One document inside a subtree link, from the entry its route's loader awaited. */
export function useLoadedSharedBody(token: string, reference: string) {
  const client = useApiClient()
  return useSuspenseQuery(sharedBodyQueryOptions(client, token, reference))
}
