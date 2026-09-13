import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { SearchProvider } from '../../features/search/search-provider.tsx'
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
  /**
   * The one thing this layout renders around every signed-in page: the search
   * palette's host.
   *
   * It is here, and not in the workspace shell, because Ctrl+K works anywhere
   * somebody is signed in — the workspace, the home page, the organisation
   * page — and this route is the only ancestor all three share. It adds no
   * chrome of its own: the shells are still the workspace layout and
   * `AppPage`, and the palette itself is a chunk fetched on demand
   * (`features/search/search-provider.tsx`), so a reader who never searches
   * pays for a context and a key listener.
   */
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return (
    <SearchProvider>
      <Outlet />
    </SearchProvider>
  )
}
