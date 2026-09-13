import { createFileRoute, notFound } from '@tanstack/react-router'

import {
  ShareUnavailableError,
  ShareUnavailableNotice,
} from '../../../../../features/share/share-chrome.tsx'
import { SharedChildPage } from '../../../../../features/share/shared-child-page.tsx'
import { ApiError, sharedBodyQueryOptions } from '../../../../../lib/api/index.ts'

/**
 * A document *inside* a subtree link.
 *
 * The address carries a document reference — the title's words and the short
 * key (ADR-035) — which `GET /api/share/:token/documents/:id/rendered`
 * resolves exactly as `/api/documents/:id` does. The link's scope is resolved
 * against the tree on **every** request, never against the tree as it was
 * when the link was made, so a document moved out from under the target is
 * refused here from that moment on.
 *
 * The refusal is the same words as the one for a dead token, rendered inside
 * the chrome the valid link already put on screen: the reason is never
 * distinguishable, which is the whole point of the contract. A failure that
 * is not an answer from the server is not a refusal at all, and says so
 * instead — see the parent route.
 */
export const Route = createFileRoute('/share/$token/d/$documentRef/')({
  loader: async ({ context, params }) => {
    try {
      const shared = await context.queryClient.ensureQueryData(
        sharedBodyQueryOptions(context.apiClient, params.token, params.documentRef),
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
  notFoundComponent: ShareUnavailableNotice,
  errorComponent: ShareUnavailableError,
  component: SharedChildPage,
})
