import { createFileRoute, redirect } from '@tanstack/react-router'

import { ApiError, meQueryOptions } from '../../lib/api/index.ts'

/**
 * The authentication gate, and the **only** place in the application that
 * checks for a session: `me` is loaded before anything below it renders, and a
 * missing or expired session redirects to sign-in with the page that was asked
 * for as the return path. No page and no loader below repeats the check.
 *
 * A pathless layout route (the `_` prefix): it wraps everything a session is
 * needed for without appearing in any address.
 *
 * `beforeLoad` runs outside React, so it reads `me` through the
 * `QueryClient`/`ApiClient` pair on router context rather than the `useMe`
 * hook, which needs `ApiClientProvider`'s React context. Both share
 * `meQueryOptions` (`lib/api/auth.ts`), so this is the same cache entry every
 * component reads.
 */
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQueryOptions(context.apiClient))
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({ to: '/sign-in', search: { redirect: location.href } })
      }
      throw error
    }
  },
  // No component: a layout route with none renders its `<Outlet />`, and this
  // one adds no chrome — the shells are the workspace layout and the pages.
})
