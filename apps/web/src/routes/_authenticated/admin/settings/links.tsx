import { createFileRoute } from '@tanstack/react-router'

import { LinkSettingsPage } from '../../../../features/settings/link-settings-page.tsx'
import { SettingsRouteError } from '../../../../features/settings/settings-route-error.tsx'
import { organisationSettingsQueryOptions } from '../../../../lib/api/index.ts'

/**
 * How Quill describes links (ADR-042, "Policy"): previews on or off, how rich,
 * for the public site, the default display, and the sites it may contact.
 */
export const Route = createFileRoute('/_authenticated/admin/settings/links')({
  head: () => ({ meta: [{ title: 'Link settings' }] }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(organisationSettingsQueryOptions(context.apiClient))
  },
  errorComponent: ({ error }) => <SettingsRouteError error={error} />,
  component: LinkSettingsPage,
})
