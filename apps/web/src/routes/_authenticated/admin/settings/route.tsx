import { Outlet, createFileRoute, notFound } from '@tanstack/react-router'

import { SettingsFrame } from '../../../../features/settings/settings-frame.tsx'
import { RouteNotice } from '../../../../features/workspaces/route-notice.tsx'
import { meQueryOptions } from '../../../../lib/api/index.ts'

/**
 * Instance settings: the organisation, its theme, the default layout, and the
 * instance's secrets (ADR-034, ADR-028; use cases 35 and 36).
 *
 * A **layout route**, so the page bar and the left navigation are rendered
 * once and keep their DOM nodes while somebody moves between the four
 * screens; each screen renders in the `<Outlet />` and contributes its own
 * controls to the bar through a portal (`settings-frame.tsx`).
 *
 * The gate is here and nowhere below it. Changing any of this is instance
 * administration, so somebody who is not an instance administrator is told
 * the page does not exist rather than that they are missing something —
 * exactly what `/admin/organisation` does, and what the API answers.
 *
 * Its own chunk, through `autoCodeSplitting`: the theme editor reaches
 * `@quill/theme`'s palette generator and colour doctor, and nobody reading a
 * document should download either (quill-plan.md section 31; review
 * 2026-09-13, H1).
 */
export const Route = createFileRoute('/_authenticated/admin/settings')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions(context.apiClient))
    if (!me.isInstanceAdmin) throw notFound()
  },
  notFoundComponent: () => (
    <RouteNotice
      title="This page is not available"
      body="Settings are for instance administrators. If something here needs to change, ask one of yours."
      full
    />
  ),
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <SettingsFrame>
      <Outlet />
    </SettingsFrame>
  )
}
