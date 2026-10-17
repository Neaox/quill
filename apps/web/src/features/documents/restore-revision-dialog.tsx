import { Button, Dialog } from '@quill/ui'

import { FormError } from '../../lib/forms/form-error.tsx'
import type { LabelledRevision } from '../../lib/documents/revision-labels.ts'

export interface RestoreRevisionDialogProps {
  /** The revision being put back; the dialog is open while there is one. */
  readonly revision: LabelledRevision | undefined
  readonly isRestoring: boolean
  readonly error: unknown
  readonly onCancel: () => void
  readonly onRestore: (revision: LabelledRevision) => void
}

/**
 * Asks before a restore, which publishes. Its own module so the revision panel
 * loads it the first time a restore is asked for, not with every reading page
 * (quill-plan.md section 31).
 */
export function RestoreRevisionDialog({
  revision,
  isRestoring,
  error,
  onCancel,
  onRestore,
}: RestoreRevisionDialogProps) {
  return (
    <Dialog
      title={`Restore ${revision?.label ?? ''}`}
      description="Restoring publishes a new revision whose content is that of the older one. Nothing is erased: the step you are undoing stays in the history."
      open={revision !== undefined}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            loading={isRestoring}
            onClick={() => {
              if (revision === undefined) return
              onRestore(revision)
            }}
          >
            Restore
          </Button>
        </>
      }
    >
      <FormError error={error} />
    </Dialog>
  )
}
