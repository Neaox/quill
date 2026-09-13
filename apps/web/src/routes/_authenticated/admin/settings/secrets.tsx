import { createFileRoute } from '@tanstack/react-router'

import { SecretsPage } from '../../../../features/settings/secrets-page.tsx'
import { secretsQueryOptions } from '../../../../lib/api/index.ts'

/**
 * The instance's secrets, and the sign-in providers configured in its
 * environment (ADR-034, ADR-011).
 *
 * The loader *prefetches* rather than awaits: this screen is a list and two
 * dialogs, so it renders its own pending and error states, and the list
 * failing is not a reason to replace the page — the rotation note and the
 * provider readout beside it are still worth reading.
 *
 * There is deliberately no `errorComponent`. A prefetch that is not awaited
 * cannot reject the loader, so one here could never render; what actually
 * shows a failed list is the page's own `secrets.isError` branch. The other
 * three screens await their settings and do carry one.
 */
export const Route = createFileRoute('/_authenticated/admin/settings/secrets')({
  head: () => ({ meta: [{ title: 'Secrets' }] }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(secretsQueryOptions(context.apiClient))
  },
  component: SecretsPage,
})
