import { createFileRoute, notFound } from '@tanstack/react-router'

import { GroupsPage } from '../../../features/admin/groups-page.tsx'
import { RouteNotice } from '../../../features/workspaces/route-notice.tsx'
import { groupsQueryOptions, meQueryOptions } from '../../../lib/api/index.ts'

/**
 * People and groups: who belongs to which group, which a grant to the group
 * then reaches (ADR-052).
 *
 * Gated like the organisation page: anybody who is not an instance
 * administrator is told the page does not exist, which is what the API tells
 * them too. The selected group lives in the address (`?group=`), so a link
 * to one group works and the browser's back button leaves it.
 *
 * Its own chunk, through `autoCodeSplitting`.
 */
export const Route = createFileRoute('/_authenticated/admin/groups')({
  head: () => ({ meta: [{ title: 'People and groups' }] }),
  validateSearch: (search: Record<string, unknown>): { group?: string } =>
    typeof search['group'] === 'string' && search['group'] !== '' ? { group: search['group'] } : {},
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions(context.apiClient))
    if (!me.isInstanceAdmin) throw notFound()
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(groupsQueryOptions(context.apiClient))
  },
  notFoundComponent: () => (
    <RouteNotice
      title="This page is not available"
      body="Managing people and groups is for instance administrators. If you need access to something, ask one of yours."
      full
    />
  ),
  errorComponent: () => (
    <RouteNotice
      title="Couldn't load people and groups"
      body="Something went wrong on the way. Reload the page to try again."
      full
    />
  ),
  component: GroupsPage,
})
