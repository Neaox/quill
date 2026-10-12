import { createFileRoute, redirect } from '@tanstack/react-router'

import { FIRST_SETTINGS_SECTION } from '../../../features/settings/settings-sections.ts'

/**
 * `/admin` has no page of its own: an administrator who types it, or trims a
 * settings address back to it, means the instance's settings, so it goes
 * straight to the first of them rather than to a not-found page.
 *
 * `beforeLoad`, not a component: the redirect happens before any chunk of a
 * page is fetched.
 */
export const Route = createFileRoute('/_authenticated/admin/')({
  beforeLoad: () => {
    throw redirect({ to: FIRST_SETTINGS_SECTION })
  },
})
