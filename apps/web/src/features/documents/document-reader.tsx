import { Link } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

import {
  Block,
  Button,
  buttonClassName,
  Callout,
  LayoutGrid,
  LocalTime,
  Spinner,
  tv,
} from '@quill/ui'

import {
  ApiError,
  useDraft,
  useRenderedDocument,
  type ComparisonRange,
} from '../../lib/api/index.ts'
import { isDocumentTree, readDraftContent } from '../../lib/documents/draft-content.ts'
import { summariseDraft, type DraftSummary } from '../../lib/documents/draft-summary.ts'
import type { LabelledRevision } from '../../lib/documents/revision-labels.ts'
import { shortRevision } from '../../lib/documents/revision-labels.ts'
import { ChildDocumentsBlock } from './child-documents-block.tsx'
import { DocumentBody } from './document-body.tsx'
import { PreviewLink } from './preview-link.tsx'

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
    bannerText: 'text-xs text-muted tabular-nums',
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
  readonly compare: ComparisonRange | undefined
  readonly revisions: readonly LabelledRevision[]
  readonly canEdit: boolean
  /** The collection the document sits in, shown above its title (`DocumentBody`). */
  readonly eyebrow?: string | undefined
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
  eyebrow,
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
      eyebrow={eyebrow}
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
  eyebrow,
}: Omit<DocumentReaderProps, 'compare'>) {
  const rendered = useRenderedDocument(documentId, revision)
  const styles = documentReaderStyles()
  // What is waiting to be published, for somebody who can write it, when there is nothing to read.
  const draft = useDraft(canEdit && rendered.isError ? documentId : undefined)
  const draftSummary = summariseDraft(
    isDocumentTree(readDraftContent(draft.data?.ast)?.ast)
      ? readDraftContent(draft.data?.ast)?.ast
      : undefined,
  )

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
            <NotPublished
              documentId={documentId}
              workspaceSlug={workspaceSlug}
              canEdit={canEdit}
              draft={draftSummary}
            />
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
  const onScreenRevision = revisions.find((candidate) => candidate.revision === onScreen)
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
                reading {labelOf(revisions, onScreen)} · published{' '}
                {onScreenRevision === undefined ? '—' : <LocalTime value={onScreenRevision.date} />}
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
        eyebrow={eyebrow}
        className={styles.body()}
        renderChildDocuments={(depth) => (
          <ChildDocumentsBlock
            documentId={documentId}
            workspaceSlug={workspaceSlug}
            depth={depth}
          />
        )}
      />
    </>
  )
}

/**
 * What a document that has never been published says in place of its body.
 *
 * "Nothing published yet" is true and not much help: a document with a draft is not empty, only not
 * out yet, and one made from a template has its sections and no writing in them. So somebody who
 * can write it is told what is waiting (its sections and how many words), and which of the two
 * it is changes what the button says. Somebody who cannot write it is told only that it has not
 * been published: advice to open the editor is not for them.
 */
function NotPublished({
  documentId,
  workspaceSlug,
  canEdit,
  draft,
}: {
  readonly documentId: string
  readonly workspaceSlug: string
  readonly canEdit: boolean
  readonly draft: DraftSummary | undefined
}) {
  const written = draft !== undefined && draft.words > 0
  const sections =
    draft === undefined
      ? ''
      : `${String(draft.sections)} ${draft.sections === 1 ? 'section' : 'sections'}`
  const [title, words, action] = !canEdit
    ? [
        'Nothing published yet',
        'This document has not been published yet. It will appear here once it is.',
        undefined,
      ]
    : written
      ? [
          'Written, but not published yet',
          `Your draft has ${sections} and about ${String(draft.words)} words. Readers see nothing until you publish it.`,
          'Continue writing',
        ]
      : draft !== undefined
        ? [
            'Nothing written yet',
            `Your draft has ${sections} and no writing in them yet. Open it to fill them in, then publish.`,
            'Start writing',
          ]
        : [
            'Nothing published yet',
            'This document has never been published, so there is no revision to read. Open it in the editor, write something, and publish.',
            'Start writing',
          ]
  return (
    <Callout tone="info" title={title}>
      {words}
      {action === undefined ? undefined : (
        <p className="flex flex-wrap items-center gap-2 pt-3">
          <Link
            to="/w/$workspaceSlug/d/$documentId/edit"
            params={{ workspaceSlug, documentId }}
            className={buttonClassName({ size: 'sm' })}
          >
            {action}
          </Link>
          {/* Only a draft with writing in it has anything to look at. */}
          {written ? (
            <PreviewLink documentRef={documentId} draft variant="ghost" size="sm" />
          ) : undefined}
        </p>
      )}
    </Callout>
  )
}
