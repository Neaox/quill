import { createFileRoute } from '@tanstack/react-router'

import { LayoutSettingsPage } from '../../../../features/settings/layout-settings-page.tsx'
import { SettingsRouteError } from '../../../../features/settings/settings-route-error.tsx'
import { organisationSettingsQueryOptions } from '../../../../lib/api/index.ts'

/**
 * The organisation's default layout, and the lock (ADR-028's amendment; use
 * case 36's organisation half).
 */
export const Route = createFileRoute('/_authenticated/admin/settings/layout')({
  head: () => ({ meta: [{ title: 'Layout' }] }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(organisationSettingsQueryOptions(context.apiClient))
  },
  errorComponent: ({ error }) => <SettingsRouteError error={error} />,
  component: LayoutSettingsPage,
})
