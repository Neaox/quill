import { createFileRoute } from '@tanstack/react-router'

import { SettingsRouteError } from '../../../../features/settings/settings-route-error.tsx'
import { ThemeSettingsPage } from '../../../../features/settings/theme-settings-page.tsx'
import { organisationSettingsQueryOptions } from '../../../../lib/api/index.ts'

/**
 * The theme editor (ADR-028, layer 2; use case 35).
 *
 * This is the route that pulls `@quill/theme`'s palette generator, colour
 * rules and doctor into the bundle, and the reason they are reached from a
 * *route component* and nowhere else: `autoCodeSplitting` gives this
 * component its own chunk, so the machinery is downloaded by somebody opening
 * the theme editor and by nobody reading a document (review 2026-09-13, H1;
 * quill-plan.md section 31).
 */
export const Route = createFileRoute('/_authenticated/admin/settings/theme')({
  head: () => ({ meta: [{ title: 'Theme' }] }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(organisationSettingsQueryOptions(context.apiClient))
  },
  errorComponent: ({ error }) => <SettingsRouteError error={error} />,
  component: ThemeSettingsPage,
})
