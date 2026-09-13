import { createFileRoute, notFound } from '@tanstack/react-router'

import { SettingsRouteError } from '../../../../features/settings/settings-route-error.tsx'
import { WorkspaceSettingsPage } from '../../../../features/settings/workspace-settings-page.tsx'
import { RouteNotice } from '../../../../features/workspaces/route-notice.tsx'
import { meQueryOptions, workspaceSettingsQueryOptions } from '../../../../lib/api/index.ts'

/**
 * A workspace's own settings, inside the shell the layout beside this file
 * renders (ADR-028's amendment; use case 36).
 *
 * The not-found is *inside* the shell — no `full` — because the sidebar and
 * the header are still there to go somewhere else with, which is the rule in
 * `docs/design/feedback.md`.
 *
 * TODO(M3): the gate is instance administration, which is narrower than the
 * rule. ADR-028 gives layout to the **workspace**, and changing it needs
 * `manage` on that workspace — but no route answers what the signed-in person
 * may do with a workspace yet: `GET /api/workspaces/:id` carries no
 * permissions, unlike a document's envelope. Gating on `manage` would mean
 * guessing, and showing the screen to everybody would mean a Save that is
 * refused for most of them, so this shows it to the people it is certainly
 * right for and widens the moment the workspace response carries its
 * permissions.
 */
export const Route = createFileRoute('/_authenticated/w/$workspaceSlug/settings')({
  head: () => ({ meta: [{ title: 'Workspace settings' }] }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions(context.apiClient))
    if (!me.isInstanceAdmin) throw notFound()
  },
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      workspaceSettingsQueryOptions(context.apiClient, params.workspaceSlug),
    )
  },
  notFoundComponent: () => (
    <RouteNotice
      title="This page is not available"
      body="Changing how a workspace is arranged is for the people who manage it."
    />
  ),
  errorComponent: ({ error }) => (
    <div className="px-8 py-8">
      <SettingsRouteError error={error} />
    </div>
  ),
  component: WorkspaceSettingsPage,
})
