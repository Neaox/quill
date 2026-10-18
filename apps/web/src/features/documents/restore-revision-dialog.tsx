import { useNavigate } from '@tanstack/react-router'
import { useRef } from 'react'

import { Button, Dialog, toast, type ToastId } from '@quill/ui'

import { useRestoreRevision } from '../../lib/api/index.ts'
import type { LabelledRevision } from '../../lib/documents/revision-labels.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { documentLink } from '../../lib/routing/document-reference.ts'

export interface RestoreRevisionDialogProps {
  readonly documentId: string
  readonly workspaceSlug: string
  /** The revision being put back; the dialog is open while there is one. */
  readonly revision: LabelledRevision | undefined
  readonly onClose: () => void
}

/**
 * Putting an older revision back, behind a confirmation (ADR-015): the one
 * restore flow, offered from the revision panel and from the comparison view.
 *
 * Restoring publishes a new revision, which is one of the three cases
 * `docs/design/feedback.md` names for a promise toast: it lands on the page
 * the person is looking at, and takes long enough that they may have looked
 * away. The button pressed keeps its own spinner; the toast says how it ended
 * wherever they are by then, with the one action that follows. A retry passes
 * the previous toast's id back, so it replaces that toast instead of stacking.
 */
export function RestoreRevisionDialog({
  documentId,
  workspaceSlug,
  revision,
  onClose,
}: RestoreRevisionDialogProps) {
  const navigate = useNavigate()
  const restore = useRestoreRevision()
  const toastId = useRef<ToastId | undefined>(undefined)

  function openHead() {
    void navigate(documentLink(workspaceSlug, documentId))
  }

  function restoreRevision(chosen: LabelledRevision) {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    toastId.current = toast.promise(
      promise,
      {
        loading: `Restoring ${chosen.label}`,
        success: {
          title: `Restored ${chosen.label}`,
          action: { label: 'Read it', onClick: openHead },
        },
        error: (reason) => ({
          title:
            reason instanceof Error
              ? reason.message
              : `Couldn't restore ${chosen.label}. Nothing was changed; try again.`,
        }),
      },
      toastId.current === undefined ? {} : { id: toastId.current },
    )

    restore.mutate(
      { documentId, revision: chosen.revision, changeNote: `Restored ${chosen.label}` },
      {
        onSuccess: (result) => {
          if (result.kind !== 'published') {
            // A restore answered with a merge is a restore that did not
            // happen: somebody published between reading this revision and
            // pressing the button.
            reject(
              new Error(
                `${chosen.label} was not restored: somebody else published first. Reload and try again.`,
              ),
            )
            return
          }
          resolve()
          onClose()
          openHead()
        },
        onError: reject,
      },
    )
  }

  return (
    <Dialog
      title={`Restore ${revision?.label ?? ''}`}
      description="Restoring publishes a new revision whose content is that of the older one. Nothing is erased: the step you are undoing stays in the history."
      open={revision !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={restore.isPending}
            onClick={() => {
              if (revision === undefined) return
              restoreRevision(revision)
            }}
          >
            Restore
          </Button>
        </>
      }
    >
      <FormError error={restore.error} />
    </Dialog>
  )
}
