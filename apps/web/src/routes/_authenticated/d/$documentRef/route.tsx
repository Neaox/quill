import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

import { AppPage } from '../../../../features/layout/app-page.tsx'
import { RouteNotice } from '../../../../features/workspaces/route-notice.tsx'
import {
  ApiError,
  documentQueryOptions,
  queryKeys,
  workspaceQueryOptions,
} from '../../../../lib/api/index.ts'
import {
  documentIdFromReference,
  documentReference,
  parseDocumentReference,
} from '../../../../lib/routing/document-reference.ts'

/**
 * `/d/<reference>`: a document by its id or key alone, which is how a link
 * inside a document is stored (ADR-035, `/d/<uuid>`) and how the editor's
 * link picker writes one.
 *
 * It names no workspace and no title, because both change and a stored link
 * must not, so it is never where a document is *read*: the loader resolves
 * the reference through the API and replaces the address with the canonical
 * `/w/<workspace>/d/<title>-<key>`, keeping the query and the section the
 * link carried (ADR-044), so a link to a heading lands on the heading and
 * Back does not return here. It is outside the workspace segment because the
 * workspace is exactly what it does not know.
 *
 * A reference that names nothing, or a document this person may not see —
 * which the API deliberately does not tell apart (ADR-012) — is a not-found
 * inside the signed-in frame, as the reading route's is inside the shell.
 */
export const Route = createFileRoute('/_authenticated/d/$documentRef')({
  loader: async ({ context, params, location }) => {
    const reference = documentIdFromReference(parseDocumentReference(params.documentRef))
    if (reference === undefined) throw notFound()

    let document
    try {
      document = await context.queryClient.ensureQueryData(
        documentQueryOptions(context.apiClient, reference),
      )
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
        throw notFound()
      }
      throw error
    }
    const workspace = await context.queryClient.ensureQueryData(
      workspaceQueryOptions(context.apiClient, document.workspaceId),
    )

    const canonical = documentReference(document)
    // The reading route asks for the document by the reference it is given,
    // so it is handed the answer under that one rather than asking again.
    context.queryClient.setQueryData(queryKeys.document(canonical), document)
    throw redirect({
      to: '/w/$workspaceSlug/d/$documentId',
      params: { workspaceSlug: workspace.slug, documentId: canonical },
      search: location.search,
      hash: location.hash,
      replace: true,
    })
  },
  notFoundComponent: () => (
    <AppPage>
      <RouteNotice
        title="We couldn't find that document"
        body="The link may be out of date, or the document may have been deleted or moved somewhere you cannot see."
      />
    </AppPage>
  ),
  errorComponent: () => (
    <AppPage>
      <RouteNotice
        title="Couldn't open this link"
        body="Something went wrong on the way. Reload the page to try again."
      />
    </AppPage>
  ),
})
