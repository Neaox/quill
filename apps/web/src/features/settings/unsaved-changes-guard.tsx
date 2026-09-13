import { useBlocker } from '@tanstack/react-router'

import { Button, Dialog } from '@quill/ui'

export interface UnsavedChangesGuardProps {
  /** True while the form holds changes the server has not been told about. */
  readonly dirty: boolean
  /** What is unsaved, named: "theme", "layout", "organisation settings". */
  readonly what: string
}

/**
 * Stops a navigation that would throw away unsaved edits, and asks instead.
 *
 * The four instance screens edit **one** document and sit one click apart in a
 * layout route that never unmounts — but each *section* does unmount, taking
 * its draft with it. Moving the accent, clicking Layout to check the default,
 * and coming back used to leave the levers as the server has them with nothing
 * having said so: a silent discard, which is the one outcome a person cannot
 * recover from and cannot even notice.
 *
 * A blocker is the right shape rather than lifting one draft into the frame:
 * the discard is a *navigation* problem, the person is the only one who knows
 * whether the edits matter, and this also catches leaving the settings area
 * altogether — and, through `enableBeforeUnload`, closing the tab. Lifting the
 * draft would make four screens share one object and still say nothing when
 * somebody left.
 *
 * `shouldBlockFn` is re-read on every navigation, so nothing needs to
 * re-register when `dirty` changes.
 */
export function UnsavedChangesGuard({ dirty, what }: UnsavedChangesGuardProps) {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })

  return (
    <Dialog
      open={blocker.status === 'blocked'}
      title={`Leave without saving the ${what}?`}
      description="The changes in this form have not been saved, and leaving discards them."
      onOpenChange={(open) => {
        if (!open) blocker.reset?.()
      }}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              blocker.reset?.()
            }}
          >
            Stay and keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              blocker.proceed?.()
            }}
          >
            Discard them
          </Button>
        </>
      }
    >
      <p>
        Nothing has been sent to the server yet. Staying keeps the form exactly as it is, so you can
        save it; leaving loses it.
      </p>
    </Dialog>
  )
}
