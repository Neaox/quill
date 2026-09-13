import { createFileRoute, notFound } from '@tanstack/react-router'

import { OrganisationPage } from '../../../features/admin/organisation-page.tsx'
import { RouteNotice } from '../../../features/workspaces/route-notice.tsx'
import {
  meQueryOptions,
  unitsQueryOptions,
  workspaceListQueryOptions,
} from '../../../lib/api/index.ts'

/**
 * Instance administration: the unit tree and the workspaces hanging off it
 * (use cases 2 and 3).
 *
 * Not an administrator? Then the page does not exist, which is the same answer
 * the API gives: `beforeLoad` turns "you are not an instance administrator"
 * into a not-found rather than a page explaining what you are missing. The
 * controls this surface carries are never rendered for a non-admin anywhere
 * else either — the home page's set-up card asks `me` the same question.
 *
 * Its own chunk, through `autoCodeSplitting`: nobody reading a document should
 * download the organisation editor (quill-plan.md section 31).
 */
export const Route = createFileRoute('/_authenticated/admin/organisation')({
  head: () => ({ meta: [{ title: 'Organisation' }] }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions(context.apiClient))
    if (!me.isInstanceAdmin) throw notFound()
  },
  loader: async ({ context }) => {
    // The two lists the page opens on, in parallel and in the cache before the
    // first render: the root units, and every workspace — which carries its
    // `unitId`, so filling the tree needs no request per unit.
    await Promise.all([
      context.queryClient.ensureQueryData(unitsQueryOptions(context.apiClient)),
      context.queryClient.ensureQueryData(workspaceListQueryOptions(context.apiClient)),
    ])
  },
  notFoundComponent: () => (
    <RouteNotice
      title="This page is not available"
      body="Managing units and workspaces is for instance administrators. If you need a workspace, ask one of yours."
      full
    />
  ),
  errorComponent: () => (
    <RouteNotice
      title="Couldn't load the organisation"
      body="Something went wrong on the way. Reload the page to try again."
      full
    />
  ),
  component: OrganisationPage,
})
