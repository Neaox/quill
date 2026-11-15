import { createFileRoute } from '@tanstack/react-router'

import { ReferencePage } from '../../../../features/reference/reference-page.tsx'
import { RouteNotice } from '../../../../features/workspaces/route-notice.tsx'
import { referenceQueryOptions, workspaceQueryOptions } from '../../../../lib/api/index.ts'

/** The kind on display and the filter, as URL state so a view is linkable (ADR-013). */
export interface ReferenceRouteSearch {
  kind?: 'code' | 'schema'
  q?: string
}

/**
 * The workspace's reference index, inside the shell the layout route draws.
 *
 * The loader resolves the workspace and prefetches only the snapshot's
 * metadata: the artifact itself is fetched when a reader presses Load, because
 * a code index is tens of megabytes and most visits only read the provenance.
 */
export const Route = createFileRoute('/_authenticated/w/$workspaceSlug/reference')({
  validateSearch: (search: Record<string, unknown>): ReferenceRouteSearch => {
    const kind = search['kind']
    const q = search['q']
    return {
      ...(kind === 'code'
        ? { kind: 'code' as const }
        : kind === 'schema'
          ? { kind: 'schema' as const }
          : {}),
      ...(typeof q === 'string' && q.trim() !== '' ? { q } : {}),
    }
  },
  loaderDeps: ({ search }) => ({ kind: search.kind ?? ('schema' as const) }),
  loader: async ({ context, params, deps }) => {
    const workspace = await context.queryClient.ensureQueryData(
      workspaceQueryOptions(context.apiClient, params.workspaceSlug),
    )
    void context.queryClient.prefetchQuery(
      referenceQueryOptions(context.apiClient, workspace.id, deps.kind),
    )
  },
  head: () => ({ meta: [{ title: 'Reference' }] }),
  errorComponent: () => (
    <RouteNotice
      title="Couldn't load the reference"
      body="Something went wrong reading the last snapshot. Reload the page to try again."
    />
  ),
  component: ReferencePage,
})
