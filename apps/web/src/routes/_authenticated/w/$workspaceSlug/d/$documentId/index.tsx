import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

import { DocumentPage } from '../../../../../../features/documents/document-page.tsx'
import {
  removedDocument,
  type RemovedDocument,
} from '../../../../../../features/documents/removed-document.ts'
import {
  RemovedDocumentNotice,
  ReplacedNote,
} from '../../../../../../features/documents/removed-document-notice.tsx'
import { RouteNotice } from '../../../../../../features/workspaces/route-notice.tsx'
import {
  ApiError,
  documentQueryOptions,
  useWorkspace,
  workspaceQueryOptions,
} from '../../../../../../lib/api/index.ts'
import {
  documentReference,
  type ComparisonLayout,
  type ComparisonView,
} from '../../../../../../lib/routing/document-reference.ts'
import { optionalStringSearch } from '../../../../../-search.ts'

/**
 * Which revision is being read, and which two are being compared, are URL
 * state (ADR-013): a comparison is a place, so it can be linked to, opened in
 * a second tab, and stepped out of with the back button.
 */
export interface DocumentSearch {
  /** A revision to read instead of the head. */
  rev?: string
  /** The older side of a comparison; absent compares against the empty document. */
  from?: string
  /** The newer side: a revision, or `draft`. Its presence is what puts the route in comparison mode. */
  to?: string
  /** How a comparison is shown: the document with its changes marked, or its source. */
  view?: ComparisonView
  /** How the source view sets the two texts out. */
  layout?: ComparisonLayout
  /**
   * The title of a removed page whose old address led here (ADR-046): said
   * once at the top, so the reader knows why they are not where they asked.
   */
  replaced?: string
}

function oneOf<T extends string>(
  search: Record<string, unknown>,
  key: string,
  values: readonly T[],
): Partial<Record<string, T>> {
  const value = search[key]
  const found = values.find((candidate) => candidate === value)
  return found === undefined ? {} : { [key]: found }
}

/**
 * Reading a document, inside the workspace shell.
 *
 * The loader puts the document in the cache before the page renders, so the
 * header's title and trail are right on the first paint rather than a frame
 * later; the body, the envelope, and the revisions stay three separate queries
 * the page owns, because they change at different times and for different
 * reasons (ADR-031).
 *
 * A document that does not exist — or that this person may not see, which the
 * API deliberately does not distinguish — is a not-found rendered **inside
 * main**, with the shell still around it to go somewhere else with.
 *
 * The parameter is a document *reference* — `<title-slug>-<key>` (ADR-035).
 * Only the key decides, and the API resolves it, so the loader hands the
 * segment straight over and then corrects the address bar to the canonical
 * form when what arrived was not it.
 */
function validateDocumentSearch(search: Record<string, unknown>): DocumentSearch {
  return {
    ...optionalStringSearch(search, 'rev'),
    ...optionalStringSearch(search, 'from'),
    ...optionalStringSearch(search, 'to'),
    ...oneOf<ComparisonView>(search, 'view', ['changes', 'source']),
    ...oneOf<ComparisonLayout>(search, 'layout', ['split', 'unified']),
    ...optionalStringSearch(search, 'replaced'),
  }
}

export const Route = createFileRoute('/_authenticated/w/$workspaceSlug/d/$documentId/')({
  validateSearch: validateDocumentSearch,
  loader: async ({ context, params, location }) => {
    // The body's deferred enhancements — its code's colours, its diagrams —
    // are their own chunk (quill-plan.md section 31), asked for now so they
    // arrive alongside the body rather than after it. A dynamic import, so
    // the route's own chunk does not carry them.
    void import('../../../../../../features/documents/deferred-enhancements.ts').catch(
      () => undefined,
    )
    let document
    try {
      document = await context.queryClient.ensureQueryData(
        documentQueryOptions(context.apiClient, params.documentId),
      )
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
        throw notFound()
      }
      // A page whose file left its repository (ADR-061, ADR-046): to the page
      // its old path now leads to, saying so, or the notice that it was removed.
      const removed = removedDocument(error)
      if (removed?.replacement !== null && removed?.replacement !== undefined) {
        throw redirect({
          to: '/w/$workspaceSlug/d/$documentId',
          params: {
            workspaceSlug: params.workspaceSlug,
            documentId: documentReference(removed.replacement),
          },
          search: { replaced: removed.title },
          replace: true,
        })
      }
      if (removed !== null) throw notFound({ data: removed })
      throw error
    }

    // Canonicalise (ADR-035). The key is the only part that decides, so a
    // stale title slug, a bare key, an old UUID, or the wrong workspace
    // segment all resolve — and then the address bar is corrected to the form
    // this document has now, with `replace` so the back button does not land
    // on the address the person just left.
    const workspace = await context.queryClient.ensureQueryData(
      workspaceQueryOptions(context.apiClient, document.workspaceId),
    )
    const canonical = documentReference(document)
    // The workspace segment is left alone when it already names *this*
    // workspace, by slug or by id: an id is not the readable form, but it is
    // not wrong either, and rewriting it would break every link that names a
    // workspace the way the API's own routes do. A segment naming a different
    // workspace — a document that has been moved — is corrected.
    const workspaceNamed =
      params.workspaceSlug === workspace.slug || params.workspaceSlug === workspace.id
    if (params.documentId !== canonical || !workspaceNamed) {
      throw redirect({
        to: '/w/$workspaceSlug/d/$documentId',
        params: { workspaceSlug: workspace.slug, documentId: canonical },
        // The revision or comparison asked for is part of the place (ADR-013):
        // correcting the address must not turn a link to one into the head.
        search: validateDocumentSearch(location.search),
        replace: true,
      })
    }

    return { title: document.title }
  },
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.title ?? 'Document' }] }),
  notFoundComponent: ({ data }) => {
    const removed = isRemoved(data) ? data : null
    return removed === null ? (
      <RouteNotice
        title="We couldn't find that document"
        body="It may have been deleted, or moved somewhere you cannot see. This workspace's documents are in the sidebar."
      />
    ) : (
      <RemovedNotice removed={removed} />
    )
  },
  errorComponent: () => (
    <RouteNotice
      title="Couldn't load this document"
      body="Something went wrong on the way. Reload the page to try again."
    />
  ),
  component: DocumentRoute,
})

/** The removal notice, with the workspace it was in for the way back. */
function RemovedNotice({ removed }: { readonly removed: RemovedDocument }) {
  const { workspaceSlug } = Route.useParams()
  const workspace = useWorkspace(workspaceSlug).data
  return <RemovedDocumentNotice removed={removed} workspace={workspace} />
}

function isRemoved(data: unknown): data is RemovedDocument {
  return typeof data === 'object' && data !== null && 'title' in data && 'replacement' in data
}

/** The page, with a line saying which removed page's address led here, when one did. */
function DocumentRoute() {
  const { replaced } = Route.useSearch()
  return (
    <>
      {replaced === undefined ? undefined : <ReplacedNote title={replaced} />}
      <DocumentPage />
    </>
  )
}
