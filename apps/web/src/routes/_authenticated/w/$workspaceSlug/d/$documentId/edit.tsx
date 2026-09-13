import { createFileRoute, notFound } from '@tanstack/react-router'

import { EditorRoute } from '../../../../../../features/documents/editor-route.tsx'
import { RouteNotice } from '../../../../../../features/workspaces/route-notice.tsx'
import { ApiError, documentQueryOptions } from '../../../../../../lib/api/index.ts'

/**
 * Writing a document, inside the same shell reading it uses — the sidebar and
 * the header do not move when a writer presses Edit.
 *
 * The editor brings ProseMirror, CodeMirror, and every grammar they need with
 * it. A reader who never edits never downloads any of it (ADR-030,
 * quill-plan.md section 31): the router plugin's `autoCodeSplitting` puts this
 * route's component in its own chunk, which is why there is no
 * `lazyRouteComponent` here any more.
 *
 * The loader resolves nothing but the document itself — normally already in
 * the cache from the reading route or the layout, so it costs no request —
 * because the tab has to say *which* document is being edited. "Editing" on
 * its own names nothing, and a writer with three tabs open cannot tell them
 * apart. The draft and the lock stay the editor's own to own.
 */
export const Route = createFileRoute('/_authenticated/w/$workspaceSlug/d/$documentId/edit')({
  loader: async ({ context, params }) => {
    try {
      const document = await context.queryClient.ensureQueryData(
        documentQueryOptions(context.apiClient, params.documentId),
      )
      return { title: document.title }
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
        throw notFound()
      }
      throw error
    }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData === undefined ? 'Editing' : `Editing ${loaderData.title}` }],
  }),
  notFoundComponent: () => (
    <RouteNotice
      title="We couldn't find that document"
      body="It may have been deleted, or moved somewhere you cannot see. This workspace's documents are in the sidebar."
    />
  ),
  errorComponent: () => (
    <RouteNotice
      title="Couldn't open this document for editing"
      body="Something went wrong on the way. Reload the page to try again."
    />
  ),
  component: EditorRoute,
})
