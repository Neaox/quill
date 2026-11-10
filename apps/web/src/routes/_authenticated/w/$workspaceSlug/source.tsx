import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

import { SourcePage } from '../../../../features/sources/source-page.tsx'
import { RouteNotice } from '../../../../features/workspaces/route-notice.tsx'
import {
  ApiError,
  meQueryOptions,
  workspaceQueryOptions,
  workspaceSourceQueryOptions,
} from '../../../../lib/api/index.ts'

/**
 * A sourced workspace's repository (ADR-061): its settings, how far it has
 * synced, what stopped it, and "Sync now", inside the workspace's shell.
 *
 * It is for whoever manages the workspace, which the API decides: a person
 * it refuses, and a workspace that is written in Quill rather than read from a
 * repository, both get the not-found inside the shell, which says what the
 * page is for rather than which of the two it was. An instance administrator
 * who opens it for a workspace written here is taken to connecting one.
 */
export const Route = createFileRoute('/_authenticated/w/$workspaceSlug/source')({
  head: () => ({ meta: [{ title: 'Repository' }] }),
  loader: async ({ context, params }) => {
    const workspace = await context.queryClient.ensureQueryData(
      workspaceQueryOptions(context.apiClient, params.workspaceSlug),
    )
    // A disconnected workspace keeps this page as the record of its repository (ADR-061).
    if (workspace.origin?.kind !== 'sourced' && workspace.origin?.disconnected !== true) {
      const me = await context.queryClient.ensureQueryData(meQueryOptions(context.apiClient))
      if (me.isInstanceAdmin) {
        throw redirect({
          to: '/w/$workspaceSlug/source/connect',
          params: { workspaceSlug: params.workspaceSlug },
          replace: true,
        })
      }
    }
    try {
      await context.queryClient.ensureQueryData(
        workspaceSourceQueryOptions(context.apiClient, workspace.id),
      )
    } catch (error) {
      if (error instanceof ApiError && [403, 404, 409].includes(error.status)) throw notFound()
      throw error
    }
  },
  notFoundComponent: () => (
    <RouteNotice
      title="This page is not available"
      body="A repository’s page belongs to a workspace that is read from one, and is for the people who manage it."
    />
  ),
  errorComponent: () => (
    <RouteNotice
      title="Couldn't load the repository"
      body="Something went wrong on the way. Reload the page to try again."
    />
  ),
  component: SourcePage,
})
