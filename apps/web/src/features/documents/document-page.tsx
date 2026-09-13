import { getRouteApi, Link } from '@tanstack/react-router'

import { buttonClassName, Menu, type MenuItem } from '@quill/ui'

import {
  useDocumentEnvelope,
  useDocumentHistory,
  useLoadedDocument,
  useRenderedDocument,
  type DiffRange,
  type OutlineEntry,
} from '../../lib/api/index.ts'
import { labelRevisions } from '../../lib/documents/revision-labels.ts'
import { useDocumentActions } from '../workspaces/document-actions.tsx'
import { RenameDocumentControl } from '../workspaces/rename-document-control.tsx'
import { ShellActions, ShellAside } from '../workspaces/shell-slots.tsx'
import { DocumentReader } from './document-reader.tsx'
import { HealthSignals } from './health-signals.tsx'
import { RevisionPanel } from './revision-panel.tsx'
import { TableOfContents } from './table-of-contents.tsx'

const routeApi = getRouteApi('/_authenticated/w/$workspaceSlug/d/$documentId/')

/** A stable empty outline, so the contents' memo is not redone on every render. */
const NO_OUTLINE: readonly OutlineEntry[] = []

/**
 * Reading a document.
 *
 * The shell around it — the header bar, the icon rail, the tree — belongs to
 * the workspace layout and is already on screen before this renders
 * (`features/workspaces/workspace-layout.tsx`); this page contributes its own
 * controls to the header and its own complementary column to the aside, and
 * otherwise renders the document into `main`. Nothing here builds chrome, so
 * moving from one document to the next replaces the article and nothing else.
 *
 * The three layers of ADR-031 are three queries and stay three queries: the
 * body comes from the render cache and is revalidated with its `ETag`, the
 * envelope (permissions, the lock holder, the last publish, health) is a
 * property of now, and the revision list is its own. Nothing merges them into
 * one "document" object, because they change at different times and for
 * different reasons.
 */
export function DocumentPage() {
  const { workspaceSlug, documentId } = routeApi.useParams()
  const { rev, from, to } = routeApi.useSearch()
  // The route's loader awaited and canonicalised this document before the page
  // was rendered, so it is in the cache on the first render: a pending branch
  // here would be unreachable code pretending to be a state (ADR-013).
  const document = useLoadedDocument(documentId)
  const envelope = useDocumentEnvelope(documentId)
  const history = useDocumentHistory(documentId)
  const rendered = useRenderedDocument(documentId, rev)
  const actions = useDocumentActions()

  const revisions = labelRevisions(history.data?.revisions ?? [], {
    complete: history.data?.nextCursor === undefined,
  })
  const lastPublished = envelope.data?.lastPublished ?? null
  const permissions = envelope.data?.permissions
  const lock = envelope.data?.lock ?? null
  const compare: DiffRange | undefined = to === undefined ? undefined : { from: from ?? null, to }
  const title = document.data.title
  /*
   * The revision whose body is on screen: the URL's if it names one, else this
   * document's own head, else whatever the render answered with. Decided here,
   * once, because two things are mounted keyed by it — the body and the
   * contents that observe the body's headings — and a body replaced under a
   * contents list that did not notice is a contents list watching nodes that
   * are no longer in the document.
   */
  const onScreen = rev ?? revisions[0]?.revision ?? rendered.data?.body.revision ?? ''

  const menuItems: readonly MenuItem[] = actions.canManage
    ? [
        { label: 'Move to…', onSelect: actions.openMove },
        { label: 'Delete…', onSelect: actions.openDelete },
      ]
    : []

  return (
    <>
      <ShellActions>
        {lock === null ? undefined : (
          <span className="meta-value hidden truncate md:inline">{lock.holderName} is editing</span>
        )}
        {actions.canManage ? (
          <RenameDocumentControl documentId={documentId} title={title} />
        ) : undefined}
        <Menu label={title} items={menuItems} />
        {/*
          Presenting is reading at projector size (quill-plan.md section 14),
          so it is offered wherever a document is read — but only once there is
          a published revision to present, since the presentation is built from
          the rendered body.
        */}
        {lastPublished === null ? undefined : (
          <Link
            to="/w/$workspaceSlug/d/$documentId/present"
            params={{ workspaceSlug, documentId }}
            search={{}}
            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
          >
            Present
          </Link>
        )}
        {permissions?.edit === true ? (
          <Link
            to="/w/$workspaceSlug/d/$documentId/edit"
            params={{ workspaceSlug, documentId }}
            className={buttonClassName({ size: 'sm' })}
          >
            Edit
          </Link>
        ) : undefined}
      </ShellActions>

      <DocumentReader
        documentId={documentId}
        workspaceSlug={workspaceSlug}
        title={title}
        revision={rev}
        onScreen={onScreen}
        compare={compare}
        revisions={revisions}
        canEdit={permissions?.edit === true}
      />

      {/*
        After the reader, deliberately: "On this page" subscribes an
        `IntersectionObserver` to the body's headings in an effect, and
        `DocumentBody` puts that body in the DOM in an effect of its own.
        React runs passive effects in tree order, so the observer has to be
        mounted after the thing it observes — which is also the order the
        shell paints them in, main before the complementary column.
      */}
      <ShellAside>
        <div className="flex flex-col gap-7">
          <RevisionPanel
            documentId={documentId}
            workspaceSlug={workspaceSlug}
            revisions={revisions}
            currentRevision={rev}
            isPending={history.isPending}
            canRestore={permissions?.edit === true}
            {...(lastPublished === null ? {} : { lastPublishedBy: lastPublished.author })}
          />
          <TableOfContents key={onScreen} outline={rendered.data?.body.outline ?? NO_OUTLINE} />
          <HealthSignals signals={envelope.data?.health ?? []} />
        </div>
      </ShellAside>
    </>
  )
}
