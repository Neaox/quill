import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { Button, formatMoment, RevisionTimeline, Spinner, toMoment, tv } from '@quill/ui'

import type { LabelledRevision } from '../../lib/documents/revision-labels.ts'
import { SelectField } from '../../lib/forms/select-field.tsx'
import { documentLink } from '../../lib/routing/document-reference.ts'
import { RouterLink } from '../../lib/routing/router-link.tsx'
import { lazyDialog } from '../dialogs/lazy-dialog.tsx'

const RestoreRevisionDialog = lazyDialog(
  async () => ({
    default: (await import('./restore-revision-dialog.tsx')).RestoreRevisionDialog,
  }),
  'Opening restore',
)

export const revisionPanelStyles = tv({
  slots: {
    root: 'flex flex-col gap-3',
    compare: 'group',
    heading: 'section-label pb-2.5',
    summary: [
      'w-fit cursor-pointer list-none rounded-sm text-xs font-medium text-foreground-soft',
      'transition-colors ease-standard hover:text-foreground focus-visible:outline-2',
      'focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    form: 'flex flex-col gap-2 pt-2',
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

/** A date in the reader's own language, for a place that can only hold text (an option in a list). */
function dateOf(timestamp: string): string {
  const moment = toMoment(timestamp)
  return moment === undefined ? '' : formatMoment(moment, 'date')
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
  const navigate = useNavigate()
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

  function openHead() {
    void navigate(linkFor(headRevision))
  }

  function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const from = form.get('from')
    const to = form.get('to')
    if (typeof from !== 'string' || typeof to !== 'string') return
    void navigate({
      to: '/w/$workspaceSlug/d/$documentId',
      params: { workspaceSlug, documentId },
      search: { from, to },
    })
  }

  const selected = currentRevision ?? head.revision
  const older = revisions[1]

  return (
    <div className={styles.root({ className })}>
      <RevisionTimeline
        label="Revisions"
        currentId={selected}
        linkComponent={RouterLink}
        revisions={revisions.map((revision) => ({
          id: revision.revision,
          label: revision.label,
          at: revision.date,
          link: linkFor(revision.revision),
        }))}
      />

      {lastPublishedBy === undefined ? undefined : (
        <p className={styles.empty()}>{`Last published by ${lastPublishedBy}`}</p>
      )}

      {revisions.length > 1 ? (
        <details className={styles.compare()}>
          <summary className={styles.summary()}>Compare</summary>
          <form onSubmit={compare} className={styles.form()}>
            <SelectField label="From" name="from" defaultValue={older?.revision}>
              {revisions.map((revision) => (
                <option key={revision.revision} value={revision.revision}>
                  {revision.label} · {dateOf(revision.date)}
                </option>
              ))}
            </SelectField>
            <SelectField label="To" name="to" defaultValue={selected}>
              {revisions.map((revision) => (
                <option key={revision.revision} value={revision.revision}>
                  {revision.label} · {dateOf(revision.date)}
                </option>
              ))}
            </SelectField>
            <Button type="submit" variant="secondary" size="sm">
              Compare
            </Button>
          </form>
        </details>
      ) : undefined}

      {canRestore && currentRevision !== undefined && currentRevision !== head.revision ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setConfirming(revisions.find((revision) => revision.revision === currentRevision))
          }}
        >
          Restore this revision
        </Button>
      ) : undefined}

      <RestoreRevisionDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined)
        }}
        documentId={documentId}
        revision={confirming}
        onRestored={openHead}
      />
    </div>
  )
}
