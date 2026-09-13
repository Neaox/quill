import { createFileRoute, redirect } from '@tanstack/react-router'

import { FIRST_SETTINGS_SECTION } from '../../../../features/settings/settings-sections.ts'

/**
 * `/admin/settings` has no page of its own: the first screen in the
 * navigation is the answer, so this redirects to it rather than showing a
 * landing page nobody would read twice.
 *
 * `beforeLoad`, not a component: the redirect happens before any chunk of a
 * page is fetched.
 */
export const Route = createFileRoute('/_authenticated/admin/settings/')({
  beforeLoad: () => {
    throw redirect({ to: FIRST_SETTINGS_SECTION })
  },
})
