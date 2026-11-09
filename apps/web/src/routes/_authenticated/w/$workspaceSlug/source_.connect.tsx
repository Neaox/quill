import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

import { ConnectSourcePage } from '../../../../features/sources/source-settings-page.tsx'
import { RouteNotice } from '../../../../features/workspaces/route-notice.tsx'
import { meQueryOptions, workspaceQueryOptions } from '../../../../lib/api/index.ts'

/**
 * Connecting a workspace written here to a Git repository (ADR-061). Only an
 * empty workspace can be connected, which the page itself says; a workspace
 * that already reads one goes to its settings instead.
 *
 * Instance administration, as the API is: the credential names a secret of
 * the whole instance. Anybody else gets the not-found inside the shell.
 */
export const Route = createFileRoute('/_authenticated/w/$workspaceSlug/source_/connect')({
  head: () => ({ meta: [{ title: 'Connect a repository' }] }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions(context.apiClient))
    if (!me.isInstanceAdmin) throw notFound()
  },
  loader: async ({ context, params }) => {
    const workspace = await context.queryClient.ensureQueryData(
      workspaceQueryOptions(context.apiClient, params.workspaceSlug),
    )
    if (workspace.origin?.kind === 'sourced') {
      throw redirect({
        to: '/w/$workspaceSlug/source/settings',
        params: { workspaceSlug: params.workspaceSlug },
        replace: true,
      })
    }
  },
  notFoundComponent: () => (
    <RouteNotice
      title="This page is not available"
      body="Connecting a workspace to a repository is for instance administrators."
    />
  ),
  errorComponent: () => (
    <RouteNotice
      title="Couldn't load the workspace"
      body="Something went wrong on the way. Reload the page to try again."
    />
  ),
  component: function Connect() {
    const { workspaceSlug } = Route.useParams()
    return <ConnectSourcePage workspaceSlug={workspaceSlug} />
  },
})
