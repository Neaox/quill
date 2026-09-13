import { Link } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

import { Block, Button, buttonClassName, Callout, LayoutGrid, Spinner, tv } from '@quill/ui'

import { ApiError, useRenderedDocument, type DiffRange } from '../../lib/api/index.ts'
import type { LabelledRevision } from '../../lib/documents/revision-labels.ts'
import { shortRevision } from '../../lib/documents/revision-labels.ts'
import { DocumentBody } from './document-body.tsx'

/**
 * The comparison view is the one part of reading a document that most readers
 * never ask for, so it is its own chunk: the reading route's first load does
 * not carry it (quill-plan.md section 31).
 */
const RevisionDiffView = lazy(async () => ({
  default: (await import('./revision-diff-view.tsx')).RevisionDiffView,
}))

export const documentReaderStyles = tv({
  slots: {
    banner: 'flex flex-wrap items-center justify-between gap-3 border-y border-border py-2.5',
    bannerText: 'meta-value',
    body: 'pt-8 pb-24',
    title: 'text-3xl leading-tight font-semibold tracking-tight text-foreground',
    centre: 'flex min-h-60 items-center justify-center',
  },
})

export interface DocumentReaderProps {
  readonly documentId: string
  readonly workspaceSlug: string
  readonly title: string
  /** The revision named in the URL; absent means the head. */
  readonly revision: string | undefined
  /**
   * The revision whose body is mounted, decided by the page so that the
   * contents list beside it is keyed by the same value.
   */
  readonly onScreen: string
  /** Two revisions named in the URL; absent means read rather than compare. */
  readonly compare: DiffRange | undefined
  readonly revisions: readonly LabelledRevision[]
  readonly canEdit: boolean
}

/** What a reader calls a revision, falling back to its short hash. */
function labelOf(revisions: readonly LabelledRevision[], revision: string | null): string {
  if (revision === null) return 'the empty document'
  return (
    revisions.find((candidate) => candidate.revision === revision)?.label ?? shortRevision(revision)
  )
}

/**
 * The document itself: its published body, or a comparison of two of its
 * revisions.
 *
 * Which of those is on screen, and at which revision, is URL state (ADR-013),
 * so every one of them can be linked to and the back button steps out of it.
 */
export function DocumentReader({
  documentId,
  workspaceSlug,
  title,
  revision,
  onScreen,
  compare,
  revisions,
  canEdit,
}: DocumentReaderProps) {
  const styles = documentReaderStyles()

  if (compare !== undefined) {
    return (
      <>
        <LayoutGrid className="pt-8">
          <Block width="wide">
            <div className={styles.banner()}>
              <p className={styles.bannerText()}>comparing revisions</p>
              <Link
                to="/w/$workspaceSlug/d/$documentId"
                params={{ workspaceSlug, documentId }}
                search={{}}
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              >
                Back to the document
              </Link>
            </div>
          </Block>
        </LayoutGrid>
        <Suspense
          fallback={
            <div className={styles.centre()}>
              <Spinner className="size-5" />
            </div>
          }
        >
          <RevisionDiffView
            documentId={documentId}
            range={compare}
            fromLabel={labelOf(revisions, compare.from)}
            toLabel={labelOf(revisions, compare.to)}
            className={styles.body()}
          />
        </Suspense>
      </>
    )
  }

  return (
    <PublishedBody
      documentId={documentId}
      workspaceSlug={workspaceSlug}
      title={title}
      revision={revision}
      onScreen={onScreen}
      revisions={revisions}
      canEdit={canEdit}
    />
  )
}

function PublishedBody({
  documentId,
  workspaceSlug,
  title,
  revision,
  onScreen,
  revisions,
  canEdit,
}: Omit<DocumentReaderProps, 'compare'>) {
  const rendered = useRenderedDocument(documentId, revision)
  const styles = documentReaderStyles()

  if (rendered.isPending) {
    return (
      <div className={styles.centre()}>
        <Spinner className="size-5" />
      </div>
    )
  }

  if (rendered.isError) {
    // Before a document's first publish there is nothing rendered to read,
    // which is the normal state of a document the New document dialog has
    // just created — an empty state with a way forward, never a failure.
    const notPublished = rendered.error instanceof ApiError && rendered.error.status === 404
    return (
      <LayoutGrid className={styles.body()}>
        <Block>
          <h1 className={styles.title()}>{title}</h1>
        </Block>
        <Block className="mt-6">
          {notPublished ? (
            <Callout tone="info" title="Nothing published yet">
              This document has never been published, so there is no revision to read. Open it in
              the editor, write something, and publish.
              {canEdit ? (
                <p className="pt-3">
                  <Link
                    to="/w/$workspaceSlug/d/$documentId/edit"
                    params={{ workspaceSlug, documentId }}
                    className={buttonClassName({ size: 'sm' })}
                  >
                    Start writing
                  </Link>
                </p>
              ) : undefined}
            </Callout>
          ) : (
            <Callout tone="danger" title="Couldn't load this document">
              {rendered.error instanceof ApiError ? rendered.error.message : 'Please try again.'}
              <p className="pt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void rendered.refetch()
                  }}
                >
                  Try again
                </Button>
              </p>
            </Callout>
          )}
        </Block>
      </LayoutGrid>
    )
  }

  const head = revisions[0]
  // The URL is what says an older revision is being read. The body's own
  // `revision` is the content store's head for the *workspace* at render
  // time, which moves whenever any document in it is published, so comparing
  // the two would call every document "older" the moment its neighbour was
  // republished.
  const isOlder = head !== undefined && revision !== undefined && revision !== head.revision
  // Every document written from a template or by hand opens with its own
  // title, which arrives in the body as an `h1`. Adding the page's title
  // above it would show it twice and give the page two first-level headings.
  const bodyHasTitle = rendered.data.body.outline[0]?.depth === 1

  return (
    <>
      {isOlder ? (
        <LayoutGrid className="pt-8">
          <Block>
            <div className={styles.banner()}>
              <p className={styles.bannerText()}>
                {`reading ${labelOf(revisions, onScreen)} · published ${
                  revisions.find((candidate) => candidate.revision === onScreen)?.date ?? '—'
                }`}
              </p>
              <Link
                to="/w/$workspaceSlug/d/$documentId"
                params={{ workspaceSlug, documentId }}
                search={{}}
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              >
                Back to the current revision
              </Link>
            </div>
          </Block>
        </LayoutGrid>
      ) : undefined}

      {bodyHasTitle ? undefined : (
        <LayoutGrid className="pt-8">
          <Block>
            <h1 className={styles.title()}>{title}</h1>
          </Block>
        </LayoutGrid>
      )}

      {/* A new revision replaces the body wholesale rather than reconciling
          against nodes the highlighting fallback may have replaced, so the
          mounted DOM is keyed by the revision it came from. */}
      <DocumentBody
        key={onScreen}
        html={rendered.data.body.html}
        label={title}
        className={styles.body()}
      />
    </>
  )
}
