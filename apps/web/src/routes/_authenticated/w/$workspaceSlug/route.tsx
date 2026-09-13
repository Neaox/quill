import { createFileRoute, notFound } from '@tanstack/react-router'

import { RouteNotice } from '../../../../features/workspaces/route-notice.tsx'
import { WorkspaceLayout } from '../../../../features/workspaces/workspace-layout.tsx'
import {
  ApiError,
  queryKeys,
  workspaceQueryOptions,
  workspaceTreeQueryOptions,
} from '../../../../lib/api/index.ts'

/**
 * The workspace shell.
 *
 * A layout route: the top bar, the icon rail and the navigation sidebar are
 * rendered once here and never unmount while a person moves between the
 * workspace home and the documents inside it. Every child renders in the
 * layout's `<Outlet />`, inside `main`, and so do their pending, error and
 * not-found states — a flash of the shell on navigation is a bug in route
 * structure, and this is where it is fixed (`docs/design/feedback.md`).
 *
 * `workspaceSlug` is the URL segment, and it is an address rather than an id:
 * `GET /api/workspaces/{idOrSlug}` resolves a slug as readily as a UUID
 * (ADR-035), so both spellings of a workspace open the same page and old links
 * keep working.
 *
 * **The loader resolves it, once.** What it returns is the workspace's real id
 * and slug, and the answer is also seeded under the id, because everything
 * below — the tree, the document list, the invalidation after a rename — is
 * keyed by that id. Resolving here rather than in each component is what stops
 * one workspace becoming two cache entries and a rename leaving the header
 * showing the old name.
 *
 * The tree is *prefetched* rather than awaited, by that resolved id: a sidebar
 * that cannot be loaded shows its own message beside a page that is otherwise
 * fine, instead of taking the page down with it.
 */
export const Route = createFileRoute('/_authenticated/w/$workspaceSlug')({
  loader: async ({ context, params }) => {
    try {
      const workspace = await context.queryClient.ensureQueryData(
        workspaceQueryOptions(context.apiClient, params.workspaceSlug),
      )
      // The canonical entry, so a component keyed by the id reads what the
      // slug lookup already answered rather than asking again.
      context.queryClient.setQueryData(queryKeys.workspace(workspace.id), workspace)
      void context.queryClient.prefetchQuery(
        workspaceTreeQueryOptions(context.apiClient, workspace.id),
      )
      return {
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
      }
    } catch (error) {
      // The API deliberately does not distinguish "forbidden" from "does not
      // exist" for a workspace (ADR-012), and neither does this.
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
        throw notFound()
      }
      throw error
    }
  },
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.workspaceName ?? 'Workspace' }] }),
  notFoundComponent: () => (
    <RouteNotice
      title="We couldn't find that workspace"
      body="It may have been deleted, or you may not have been given access to it. Your other workspaces are on the home page."
      full
    />
  ),
  errorComponent: () => (
    <RouteNotice
      title="Couldn't load this workspace"
      body="Something went wrong on the way. Reload the page to try again."
      full
    />
  ),
  component: WorkspaceLayout,
})
