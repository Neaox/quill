import { createFileRoute } from '@tanstack/react-router'

import { PreferencesPage } from '../../features/preferences/preferences-page.tsx'
import { personPreferencesQueryOptions } from '../../lib/api/index.ts'

/**
 * The person's own preferences (ADR-034), reached from the person menu.
 * Anybody signed in has one, so the session gate above is the only gate.
 *
 * `prefetchQuery` rather than `ensureQueryData`: a failed read is the page's
 * to explain beside the control, not a reason to replace the page.
 */
export const Route = createFileRoute('/_authenticated/preferences')({
  head: () => ({ meta: [{ title: 'Preferences' }] }),
  loader: async ({ context }) => {
    await context.queryClient.prefetchQuery(personPreferencesQueryOptions(context.apiClient))
  },
  component: PreferencesPage,
})
