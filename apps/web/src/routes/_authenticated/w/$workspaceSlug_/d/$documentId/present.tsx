import { createFileRoute, notFound } from '@tanstack/react-router'

import { PresentRoute } from '../../../../../../features/documents/present/present-route.tsx'
import { RouteNotice } from '../../../../../../features/workspaces/route-notice.tsx'
import {
  ApiError,
  documentQueryOptions,
  renderedQueryOptions,
} from '../../../../../../lib/api/index.ts'

/**
 * Which section is on the projector is URL state (ADR-013), so a refresh, a
 * second screen, and a link shared into a chat all land on the same one. It is
 * counted from one, because it is a number people read aloud and type.
 */
export interface PresentSearch {
  step?: number
}

/**
 * Presentation mode is the reading view's renderer at projector size
 * (quill-plan.md section 14): the whole screen is the document, so this route
 * deliberately breaks out of the workspace shell — the trailing `_` on the
 * `$workspaceSlug` directory is the file-based router's way of saying "this
 * address nests, this layout does not".
 *
 * Most readers never present, so `autoCodeSplitting` gives it its own chunk.
 *
 * The loader awaits both things a projector cannot show anything without: the
 * document, and the rendered body the steps are cut from. Doing it here rather
 * than in the component is the difference between a spinner followed by a
 * client waterfall — the body's request starting only once the document's had
 * come back — and a screen that is ready when it appears. A presentation is
 * started in front of a room; it is the last place to make somebody wait
 * twice.
 */
export const Route = createFileRoute('/_authenticated/w/$workspaceSlug_/d/$documentId/present')({
  validateSearch: (search: Record<string, unknown>): PresentSearch => {
    const raw = search['step']
    const step = typeof raw === 'number' ? raw : Number(raw)
    return Number.isInteger(step) && step > 0 ? { step } : {}
  },
  loader: async ({ context, params }) => {
    // Both at once, and only the document's answer decides anything: a
    // document that has never been published has no body to present, and the
    // page's own empty state says so with a way back to reading it. Asking for
    // it here is still what removes the waterfall.
    const [document] = await Promise.allSettled([
      context.queryClient.ensureQueryData(
        documentQueryOptions(context.apiClient, params.documentId),
      ),
      context.queryClient.ensureQueryData(
        renderedQueryOptions(context.apiClient, context.queryClient, params.documentId),
      ),
    ])

    if (document.status === 'rejected') {
      const error: unknown = document.reason
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
        throw notFound()
      }
      throw error
    }
    return { title: document.value.title }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData === undefined ? 'Presenting' : `Presenting ${loaderData.title}` }],
  }),
  notFoundComponent: () => (
    <RouteNotice
      title="We couldn't find that document"
      body="It may have been deleted, or moved somewhere you cannot see."
      full
    />
  ),
  errorComponent: () => (
    <RouteNotice
      title="Couldn't open this presentation"
      body="Something went wrong on the way. Reload the page to try again."
      full
    />
  ),
  component: PresentRoute,
})
