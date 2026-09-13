import { createFileRoute, notFound } from '@tanstack/react-router'

import { ShareFailed, ShareNotAvailable } from '../../../features/share/share-chrome.tsx'
import { ShareLayout } from '../../../features/share/share-layout.tsx'
import { ApiError, sharedDocumentQueryOptions } from '../../../lib/api/index.ts'

/**
 * The share-link surface (plan section 14; use cases 24–26;
 * `docs/architecture/api-contract-share-links.md`).
 *
 * A **root-level** route, deliberately outside `_authenticated` and outside
 * the workspace shell: it takes no session, reads no cookie, and shows
 * nothing from the signed-in world. A member who opens a link gets this page,
 * exactly as a stranger does — the same rule the public site follows
 * (`docs/product/surfaces.md`).
 *
 * **Every refusal is the same page.** The API answers an unknown token, an
 * expired or revoked link, a document outside the link's scope, one with
 * nothing published, and a document it cannot place at all with one identical
 * `404`, because telling them apart is the enumeration a 256-bit token's
 * unguessability rests on not existing. The server has already flattened
 * those into one answer by the time the loader sees it, so the loader keeps
 * the promise simply: every answer the *server* gave is the one refusal.
 *
 * A failure that is not an answer — a proxy's `500`, a connection that never
 * arrived — is not a statement about the link and is not dressed up as one:
 * it is rethrown to `errorComponent`, which says the page could not be loaded
 * and offers no way into the application either. The signed-in twin of this
 * route draws the same line.
 *
 * **`noindex`** on the page as well as on the API response it is built from:
 * share-link routes are in no sitemap and in no index. `referrer` is set here
 * too, because the token is a path segment and nothing yet serves this page's
 * HTML with the API's own security headers.
 *
 * The route's component is its own chunk (`autoCodeSplitting`), so a reader
 * of the application never loads the share surface, and a reader of a share
 * link never loads the workspace shell.
 */
export const Route = createFileRoute('/share/$token')({
  loader: async ({ context, params }) => {
    try {
      const shared = await context.queryClient.ensureQueryData(
        sharedDocumentQueryOptions(context.apiClient, params.token),
      )
      return { title: shared.document.title }
    } catch (error) {
      if (error instanceof ApiError) throw notFound()
      throw error
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.title ?? 'Shared document' },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'strict-origin-when-cross-origin' },
    ],
  }),
  notFoundComponent: ShareNotAvailable,
  errorComponent: ShareFailed,
  component: ShareLayout,
})
