import { useNavigate } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'

import { Button, Dialog, RevisionTimeline, Spinner, toast, tv, type ToastId } from '@quill/ui'

import type { LabelledRevision } from '../../lib/documents/revision-labels.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { SelectField } from '../../lib/forms/select-field.tsx'
import { useRestoreRevision } from '../../lib/api/index.ts'
import { documentLink } from '../../lib/routing/document-reference.ts'
import { RouterLink } from '../../lib/routing/router-link.tsx'

export const revisionPanelStyles = tv({
  slots: {
    root: 'flex flex-col gap-3',
    compare: 'group',
    summary: [
      'meta cursor-pointer list-none pt-1 text-muted transition-colors ease-standard',
      'hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2',
      'focus-visible:outline-focus-ring',
    ],
    form: 'flex flex-col gap-2 pt-2',
    empty: 'meta-value',
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
  const restore = useRestoreRevision()
  const [confirming, setConfirming] = useState<LabelledRevision | undefined>(undefined)
  // One promise toast per process (`docs/design/feedback.md`): a retry passes
  // the previous id back so it replaces that toast instead of stacking one.
  const restoreToastId = useRef<ToastId | undefined>(undefined)
  const head = revisions[0]
  const styles = revisionPanelStyles()

  if (isPending) {
    return (
      <div className={styles.root({ className })}>
        <p className="meta pb-2">Revisions</p>
        <Spinner className="size-4" />
      </div>
    )
  }

  if (head === undefined) {
    return (
      <div className={styles.root({ className })}>
        <p className="meta pb-2">Revisions</p>
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

  /**
   * Restoring publishes a new revision (ADR-015), which is one of the three
   * cases `docs/design/feedback.md` names for a promise toast: it lands on the
   * page the person is looking at, and it takes long enough that they may have
   * looked away. The button pressed keeps its own spinner; this says how it
   * ended wherever they are by then, with the one action that follows.
   */
  function restoreRevision(revision: LabelledRevision) {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    restoreToastId.current = toast.promise(
      promise,
      {
        loading: `Restoring ${revision.label}`,
        success: {
          title: `Restored ${revision.label}`,
          action: { label: 'Read it', onClick: openHead },
        },
        error: (reason) => ({
          title:
            reason instanceof Error
              ? reason.message
              : `Couldn't restore ${revision.label}. Nothing was changed; try again.`,
        }),
      },
      restoreToastId.current === undefined ? {} : { id: restoreToastId.current },
    )

    restore.mutate(
      {
        documentId,
        revision: revision.revision,
        changeNote: `Restored ${revision.label}`,
      },
      {
        onSuccess: (result) => {
          if (result.kind !== 'published') {
            // A restore answered with a merge is a restore that did not
            // happen: somebody published between reading this revision and
            // pressing the button.
            reject(
              new Error(
                `${revision.label} was not restored: somebody else published first. Reload and try again.`,
              ),
            )
            return
          }
          resolve()
          setConfirming(undefined)
          openHead()
        },
        onError: reject,
      },
    )
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
        <p className={styles.empty()}>{`last published by ${lastPublishedBy}`}</p>
      )}

      {revisions.length > 1 ? (
        <details className={styles.compare()}>
          <summary className={styles.summary()}>Compare</summary>
          <form onSubmit={compare} className={styles.form()}>
            <SelectField label="From" name="from" defaultValue={older?.revision}>
              {revisions.map((revision) => (
                <option key={revision.revision} value={revision.revision}>
                  {revision.label} · {revision.date}
                </option>
              ))}
            </SelectField>
            <SelectField label="To" name="to" defaultValue={selected}>
              {revisions.map((revision) => (
                <option key={revision.revision} value={revision.revision}>
                  {revision.label} · {revision.date}
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

      <Dialog
        title={`Restore ${confirming?.label ?? ''}`}
        description="Restoring publishes a new revision whose content is that of the older one. Nothing is erased: the step you are undoing stays in the history."
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined)
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(undefined)
              }}
            >
              Cancel
            </Button>
            <Button
              loading={restore.isPending}
              onClick={() => {
                if (confirming === undefined) return
                restoreRevision(confirming)
              }}
            >
              Restore
            </Button>
          </>
        }
      >
        <FormError error={restore.error} />
      </Dialog>
    </div>
  )
}
