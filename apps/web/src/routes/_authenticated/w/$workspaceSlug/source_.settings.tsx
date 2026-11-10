import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

import { EditSourcePage } from '../../../../features/sources/source-settings-page.tsx'
import { RouteNotice } from '../../../../features/workspaces/route-notice.tsx'
import {
  meQueryOptions,
  workspaceQueryOptions,
  workspaceSourceQueryOptions,
} from '../../../../lib/api/index.ts'

/**
 * Changing where a sourced workspace reads from, or what it reads (ADR-061):
 * the branch, the credential, the manifest entry or the collections, each
 * change previewed before it is saved.
 *
 * Instance administration, as the API is. A workspace manager reads the
 * settings on the repository's page; anybody else gets the not-found inside
 * the shell. A workspace that reads no repository goes to connecting one.
 */
export const Route = createFileRoute('/_authenticated/w/$workspaceSlug/source_/settings')({
  head: () => ({ meta: [{ title: 'Repository settings' }] }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions(context.apiClient))
    if (!me.isInstanceAdmin) throw notFound()
  },
  loader: async ({ context, params }) => {
    const workspace = await context.queryClient.ensureQueryData(
      workspaceQueryOptions(context.apiClient, params.workspaceSlug),
    )
    if (workspace.origin?.kind !== 'sourced') {
      throw redirect({
        // A disconnected workspace's settings are a record, on the repository's page.
        to:
          workspace.origin?.disconnected === true
            ? '/w/$workspaceSlug/source'
            : '/w/$workspaceSlug/source/connect',
        params: { workspaceSlug: params.workspaceSlug },
        replace: true,
      })
    }
    await context.queryClient.ensureQueryData(
      workspaceSourceQueryOptions(context.apiClient, workspace.id),
    )
  },
  notFoundComponent: () => (
    <RouteNotice
      title="This page is not available"
      body="Changing where a workspace reads from is for instance administrators."
    />
  ),
  errorComponent: () => (
    <RouteNotice
      title="Couldn't load the repository settings"
      body="Something went wrong on the way. Reload the page to try again."
    />
  ),
  component: function Settings() {
    const { workspaceSlug } = Route.useParams()
    return <EditSourcePage workspaceSlug={workspaceSlug} />
  },
})
