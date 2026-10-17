import { getRouteApi, Link } from '@tanstack/react-router'
import { lazy, useState } from 'react'

import { Button, buttonClassName, Menu, PresentIcon, ShareIcon, type MenuItem } from '@quill/ui'

import {
  useDocumentEnvelope,
  useDocumentHistory,
  useLoadedDocument,
  useRenderedDocument,
  useTreeCollections,
  type ComparisonRange,
  type OutlineEntry,
} from '../../lib/api/index.ts'
import { useRecordViewOnOpen } from './use-record-view-on-open.ts'
import { labelRevisions } from '../../lib/documents/revision-labels.ts'
import { useDocumentActions } from '../workspaces/document-actions.tsx'
import { RenameDocumentControl } from '../workspaces/rename-document-control.tsx'
import { ShellActions, ShellAside } from '../workspaces/shell-slots.tsx'
import { ReviewActions } from '../review/review-actions.tsx'
import { MountOnFirstOpen } from '../../lib/mount-on-first-open.tsx'
import { DraftNotice } from './draft-notice.tsx'
import { DocumentReader } from './document-reader.tsx'
import { HealthSignals } from './health-signals.tsx'
import { PreviewLink } from './preview-link.tsx'
import { RevisionPanel } from './revision-panel.tsx'
import { TableOfContents } from './table-of-contents.tsx'

const AttachmentsPanel = lazy(async () => ({
  default: (await import('./attachments-panel.tsx')).AttachmentsPanel,
}))

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
  // The sidebar has already asked for the collections, so naming the collection is
  // a cache read rather than a request of its own.
  const collections = useTreeCollections(document.data.workspaceId)
  const actions = useDocumentActions()
  const [showingAttachments, setShowingAttachments] = useState(false)
  useRecordViewOnOpen(documentId)

  const revisions = labelRevisions(history.data?.revisions ?? [], {
    complete: history.data?.nextCursor === undefined,
  })
  const lastPublished = envelope.data?.lastPublished ?? null
  const permissions = envelope.data?.permissions
  const lock = envelope.data?.lock ?? null
  const compare: ComparisonRange | undefined =
    to === undefined ? undefined : { from: from ?? null, to }
  const title = document.data.title
  const collectionName = collections.data?.find(
    (collection) => collection.id === document.data.collectionId,
  )?.name
  /*
   * The revision whose body is on screen: the URL's if it names one, else this
   * document's own head, else whatever the render answered with. Decided here,
   * once, because two things are mounted keyed by it — the body and the
   * contents that observe the body's headings — and a body replaced under a
   * contents list that did not notice is a contents list watching nodes that
   * are no longer in the document.
   */
  const onScreen = rev ?? revisions[0]?.revision ?? rendered.data?.body.revision ?? ''

  // Reachable by anyone who may read the document: the list is what it
  // carries, which is part of reading it. Deleting from the panel needs
  // `edit`, which the panel asks about itself.
  const menuItems: readonly MenuItem[] = [
    {
      label: 'Attachments…',
      onSelect: () => {
        setShowingAttachments(true)
      },
    },
    ...(actions.canManage
      ? [
          { label: 'Move to…', onSelect: actions.openMove },
          { label: 'Delete…', onSelect: actions.openDelete },
        ]
      : []),
  ]

  return (
    <>
      <ShellActions>
        {lock === null ? undefined : (
          <span className="hidden truncate text-xs text-muted md:inline">
            {lock.holderName} is editing
          </span>
        )}
        {actions.canManage ? (
          <RenameDocumentControl documentId={documentId} title={title} />
        ) : undefined}
        <Menu label={title} items={menuItems} />
        {/*
          Present and Share keep their words on every screen wide enough to
          hold them, and give them up for their icons below that, where the
          bar has room for the title and the controls and nothing else; the
          words stay their accessible names throughout.

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
            title="Present"
            className={buttonClassName({ variant: 'ghost', className: 'max-lg:px-2' })}
          >
            <PresentIcon />
            <span className="max-lg:sr-only">Present</span>
          </Link>
        )}
        {/*
          Preview opens the page as a reader will meet it — the public site's
          own chrome and theme — from the latest published revision, so it is
          offered beside Present, under the same condition.
        */}
        {lastPublished === null ? undefined : (
          <PreviewLink documentRef={documentId} variant="ghost" size="md" className="max-lg:px-2" />
        )}
        {/*
          Sharing is granting access, so it is offered to whoever may grant it
          — `manage`, the same permission the API's three link routes require
          (`docs/architecture/api-contract-share-links.md`) — and beside Edit,
          where the canvas puts it.
        */}
        {actions.canManage ? (
          <Button
            variant="ghost"
            className="max-lg:px-2"
            title="Share"
            iconStart={<ShareIcon />}
            loading={actions.isOpeningShare}
            onClick={actions.openShare}
          >
            <span className="max-lg:sr-only">Share</span>
          </Button>
        ) : undefined}
        {permissions === undefined ? undefined : (
          <ReviewActions
            documentId={documentId}
            title={title}
            // Only a draft with something in it is worth a review.
            canEdit={permissions.edit && envelope.data?.draft != null}
            canPublish={permissions.publish}
            published={lastPublished?.revision ?? null}
          />
        )}
        {permissions?.edit === true ? (
          <Link
            to="/w/$workspaceSlug/d/$documentId/edit"
            params={{ workspaceSlug, documentId }}
            className={buttonClassName({ variant: 'soft' })}
          >
            Edit
          </Link>
        ) : undefined}
      </ShellActions>

      <MountOnFirstOpen open={showingAttachments}>
        <AttachmentsPanel
          documentId={documentId}
          open={showingAttachments}
          onOpenChange={setShowingAttachments}
          canEdit={permissions?.edit === true}
        />
      </MountOnFirstOpen>

      {/*
        Only above a page that exists: a document never published has no
        "published page" readers still see, and its own empty state already
        says what is waiting.
      */}
      {permissions?.edit === true && envelope.data?.draft != null && lastPublished !== null ? (
        <DraftNotice
          workspaceSlug={workspaceSlug}
          documentId={documentId}
          savedAt={envelope.data.draft.savedAt}
          actions={
            <ReviewActions
              surface="notice"
              documentId={documentId}
              title={title}
              canEdit
              canPublish={permissions.publish}
              published={lastPublished.revision}
            />
          }
        />
      ) : undefined}

      <DocumentReader
        documentId={documentId}
        workspaceSlug={workspaceSlug}
        title={title}
        revision={rev}
        onScreen={onScreen}
        compare={compare}
        revisions={revisions}
        canEdit={permissions?.edit === true}
        eyebrow={collectionName}
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
        {/*
          "On this page" first: it is what a reader reaches for while reading,
          so it sits at the top of the column, level with the title. The
          history and the health of the document follow, for the reader who
          came to ask about it rather than to read it.
        */}
        <div className="flex flex-col gap-9">
          <TableOfContents key={onScreen} outline={rendered.data?.body.outline ?? NO_OUTLINE} />
          <RevisionPanel
            documentId={documentId}
            workspaceSlug={workspaceSlug}
            revisions={revisions}
            currentRevision={rev}
            isPending={history.isPending}
            canRestore={permissions?.publish === true}
            {...(lastPublished === null ? {} : { lastPublishedBy: lastPublished.author })}
          />
          <HealthSignals signals={envelope.data?.health ?? []} />
        </div>
      </ShellAside>
    </>
  )
}
