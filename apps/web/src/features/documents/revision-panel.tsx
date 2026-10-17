import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import {
  Button,
  buttonClassName,
  CompareIcon,
  RestoreIcon,
  RevisionTimeline,
  Spinner,
  tv,
} from '@quill/ui'

import type { LabelledRevision } from '../../lib/documents/revision-labels.ts'
import { comparisonLink, documentLink } from '../../lib/routing/document-reference.ts'
import { RouterLink } from '../../lib/routing/router-link.tsx'
import { RestoreRevisionDialog } from './restore-revision-dialog.tsx'

export const revisionPanelStyles = tv({
  slots: {
    root: 'flex flex-col gap-3',
    heading: 'section-label pb-2.5',
    actions: 'flex flex-wrap items-center gap-1.5',
    empty: 'text-xs leading-snug text-muted',
  },
})

export interface RevisionPanelProps {
  readonly documentId: string
  readonly workspaceSlug: string
  readonly revisions: readonly LabelledRevision[]
  /** The revision on screen: the head unless the URL names an older one. */
  readonly currentRevision: string | undefined
  readonly isPending: boolean
  /** ADR-015: restoring publishes, so it needs the right to publish. */
  readonly canRestore: boolean
  /**
   * Who published the current revision, from the envelope. Deliberately not
   * called the owner: ADR-029's `owners` is a front-matter field, and the
   * person who last published is not necessarily one of them.
   */
  readonly lastPublishedBy?: string | undefined
  readonly className?: string | undefined
}

/**
 * The comparison "Compare versions" opens: the revision being read against
 * the one before it, or — reading the very first — the first against the
 * second. Newest first, as the history is.
 */
export function defaultComparison(
  revisions: readonly LabelledRevision[],
  selected: string,
): { readonly from: string; readonly to: string } {
  const at = Math.max(
    0,
    revisions.findIndex((revision) => revision.revision === selected),
  )
  const newer = Math.min(at, revisions.length - 2)
  return {
    from: revisions[newer + 1]?.revision ?? selected,
    to: revisions[newer]?.revision ?? selected,
  }
}

/**
 * Every publish, with the two things a reader does with one: compare it with
 * another, and put it back.
 *
 * The list is `@quill/ui`'s `RevisionTimeline`, so it is the same component
 * the showcase and every theme variant already agree on; the two actions are
 * the feature's. Which revision is on screen and which two are being compared
 * are *URL* state (ADR-013), so a comparison can be linked to and the back
 * button steps out of it.
 */
export function RevisionPanel({
  documentId,
  workspaceSlug,
  revisions,
  currentRevision,
  isPending,
  canRestore,
  lastPublishedBy,
  className,
}: RevisionPanelProps) {
  const [confirming, setConfirming] = useState<LabelledRevision | undefined>(undefined)
  const head = revisions[0]
  const styles = revisionPanelStyles()

  if (isPending) {
    return (
      <div className={styles.root({ className })}>
        <p className={styles.heading()}>Revisions</p>
        <Spinner className="size-4" />
      </div>
    )
  }

  if (head === undefined) {
    return (
      <div className={styles.root({ className })}>
        <p className={styles.heading()}>Revisions</p>
        <p className={styles.empty()}>not published yet</p>
      </div>
    )
  }

  const headRevision = head.revision

  /**
   * Where a revision is read. Naming the newest revision in the query string
   * would make two URLs for one page, so the head gets the bare address.
   */
  function linkFor(revision: string) {
    return documentLink(
      workspaceSlug,
      documentId,
      revision === headRevision ? {} : { rev: revision },
    )
  }

  const selected = currentRevision ?? head.revision

  return (
    <div className={styles.root({ className })}>
      <RevisionTimeline
        label="Revisions"
        currentId={selected}
        linkComponent={RouterLink}
        revisions={revisions.map((revision, index) => {
          const previous = revisions[index + 1]
          return {
            id: revision.revision,
            label: revision.label,
            at: revision.date,
            link: linkFor(revision.revision),
            ...(previous === undefined
              ? {}
              : {
                  compare: comparisonLink(workspaceSlug, documentId, {
                    from: previous.revision,
                    to: revision.revision,
                  }),
                }),
          }
        })}
      />

      {lastPublishedBy === undefined ? undefined : (
        <p className={styles.empty()}>{`Last published by ${lastPublishedBy}`}</p>
      )}

      <div className={styles.actions()}>
        {revisions.length > 1 ? (
          // The newest two by default, or the revision being read against the
          // one before it: the comparison a reader most often wants.
          <Link
            {...comparisonLink(workspaceSlug, documentId, defaultComparison(revisions, selected))}
            className={buttonClassName({ variant: 'ghost', size: 'sm', className: '-ms-2' })}
          >
            <CompareIcon />
            Compare versions
          </Link>
        ) : undefined}

        {canRestore && currentRevision !== undefined && currentRevision !== head.revision ? (
          <Button
            variant="secondary"
            size="sm"
            iconStart={<RestoreIcon />}
            onClick={() => {
              setConfirming(revisions.find((revision) => revision.revision === currentRevision))
            }}
          >
            Restore this revision
          </Button>
        ) : undefined}
      </div>

      <RestoreRevisionDialog
        documentId={documentId}
        workspaceSlug={workspaceSlug}
        revision={confirming}
        onClose={() => {
          setConfirming(undefined)
        }}
      />
    </div>
  )
}
