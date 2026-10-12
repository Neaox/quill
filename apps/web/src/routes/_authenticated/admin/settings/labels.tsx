import { createFileRoute } from '@tanstack/react-router'

import { LabelsAndEmojiPage } from '../../../../features/settings/labels-and-emoji-page.tsx'
import { SettingsRouteError } from '../../../../features/settings/settings-route-error.tsx'
import { organisationSettingsQueryOptions } from '../../../../lib/api/index.ts'

/**
 * The organisation's labels (ADR-037, in the theme) and emoji (ADR-038).
 *
 * Like Theme, this route reaches `@quill/theme`'s generator from its own
 * component — a label's pill is previewed in the palettes it generates — so
 * `autoCodeSplitting` keeps that machinery in this route's chunk and out of
 * every document reader's (quill-plan.md section 31).
 */
export const Route = createFileRoute('/_authenticated/admin/settings/labels')({
  head: () => ({ meta: [{ title: 'Labels and emoji' }] }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(organisationSettingsQueryOptions(context.apiClient))
  },
  errorComponent: ({ error }) => <SettingsRouteError error={error} />,
  component: LabelsAndEmojiPage,
})
