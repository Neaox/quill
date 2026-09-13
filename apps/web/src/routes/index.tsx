import { createFileRoute, redirect } from '@tanstack/react-router'

import { HomePage } from '../features/home/home-page.tsx'
import { ApiError, meQueryOptions, workspaceListQueryOptions } from '../lib/api/index.ts'

/**
 * The signed-in home (`docs/design/home.md`): the person, not a workspace, is
 * the subject. Signed out it is the sign-in page; with exactly one visible
 * workspace it is that workspace, because a list of one is a detour.
 *
 * It is not inside `_authenticated`, because it redirects a signed-out visit
 * with no return path — arriving at `/` is not asking for a page to come back
 * to — so it asks `me` itself, through the same cache entry the gate uses.
 *
 * The workspace list is loaded here rather than in the component, so the first
 * render already has it and the sections below it (Continue, Recently updated)
 * fan out from it without waiting for a second round trip.
 */
export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: 'Home' }] }),
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQueryOptions(context.apiClient))
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({ to: '/sign-in' })
      }
      throw error
    }
    const workspaces = await context.queryClient.ensureQueryData(
      workspaceListQueryOptions(context.apiClient),
    )
    const only = workspaces.length === 1 ? workspaces[0] : undefined
    if (only !== undefined) {
      throw redirect({ to: '/w/$workspaceSlug', params: { workspaceSlug: only.id } })
    }
  },
  component: HomePage,
})
