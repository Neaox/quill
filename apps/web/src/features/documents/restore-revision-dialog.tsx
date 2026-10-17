import { useRef } from 'react'

import { Button, Dialog, toast, type ToastId } from '@quill/ui'

import { useRestoreRevision } from '../../lib/api/index.ts'
import type { LabelledRevision } from '../../lib/documents/revision-labels.ts'
import { FormError } from '../../lib/forms/form-error.tsx'

export interface RestoreRevisionDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly documentId: string
  /** The revision being put back; `undefined` while the dialog is closing. */
  readonly revision: LabelledRevision | undefined
  /** Called once the restore has published, to read the new head. */
  readonly onRestored: () => void
}

/**
 * Confirms putting an older revision back.
 *
 * Its own module so the reading page loads it the first time somebody asks to
 * restore (`lazyDialog`), not with the revision list
 * (`docs/operations/bundle-budget.md`).
 *
 * Restoring publishes a new revision (ADR-015), which is one of the three
 * cases `docs/design/feedback.md` names for a promise toast: it lands on the
 * page the person is looking at, and it takes long enough that they may have
 * looked away. The button pressed keeps its own spinner; the toast says how it
 * ended wherever they are by then, with the one action that follows.
 */
export function RestoreRevisionDialog({
  open,
  onOpenChange,
  documentId,
  revision,
  onRestored,
}: RestoreRevisionDialogProps) {
  const restore = useRestoreRevision()
  // One promise toast per process (`docs/design/feedback.md`): a retry passes
  // the previous id back so it replaces that toast instead of stacking one.
  const restoreToastId = useRef<ToastId | undefined>(undefined)

  function restoreRevision(target: LabelledRevision) {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    restoreToastId.current = toast.promise(
      promise,
      {
        loading: `Restoring ${target.label}`,
        success: {
          title: `Restored ${target.label}`,
          action: { label: 'Read it', onClick: onRestored },
        },
        error: (reason) => ({
          title:
            reason instanceof Error
              ? reason.message
              : `Couldn't restore ${target.label}. Nothing was changed; try again.`,
        }),
      },
      restoreToastId.current === undefined ? {} : { id: restoreToastId.current },
    )

    restore.mutate(
      {
        documentId,
        revision: target.revision,
        changeNote: `Restored ${target.label}`,
      },
      {
        onSuccess: (result) => {
          if (result.kind !== 'published') {
            // A restore answered with a merge is a restore that did not
            // happen: somebody published between reading this revision and
            // pressing the button.
            reject(
              new Error(
                `${target.label} was not restored: somebody else published first. Reload and try again.`,
              ),
            )
            return
          }
          resolve()
          onOpenChange(false)
          onRestored()
        },
        onError: reject,
      },
    )
  }

  return (
    <Dialog
      title={`Restore ${revision?.label ?? ''}`}
      description="Restoring publishes a new revision whose content is that of the older one. Nothing is erased: the step you are undoing stays in the history."
      open={open}
      onOpenChange={onOpenChange}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false)
            }}
          >
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
