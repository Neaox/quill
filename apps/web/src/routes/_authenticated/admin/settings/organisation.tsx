import { createFileRoute } from '@tanstack/react-router'

import { OrganisationSettingsPage } from '../../../../features/settings/organisation-settings-page.tsx'
import { SettingsRouteError } from '../../../../features/settings/settings-route-error.tsx'
import { organisationSettingsQueryOptions } from '../../../../lib/api/index.ts'

/**
 * The organisation's name, mark, public navigation and policies (ADR-034).
 *
 * The loader awaits the settings through the same options factory the page
 * reads with, so the first render already has them and the page has no
 * pending branch. A failure — which for this route means the settings file
 * this release cannot read — reaches `errorComponent` with the revision an
 * instance administrator needs to repair it.
 */
export const Route = createFileRoute('/_authenticated/admin/settings/organisation')({
  head: () => ({ meta: [{ title: 'Organisation settings' }] }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(organisationSettingsQueryOptions(context.apiClient))
  },
  errorComponent: ({ error }) => <SettingsRouteError error={error} />,
  component: OrganisationSettingsPage,
})
