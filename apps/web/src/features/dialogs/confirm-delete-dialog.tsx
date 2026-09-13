import type { ReactNode } from 'react'

import { Button, Callout, Dialog, Spinner, type DialogElevation } from '@quill/ui'

import { FormError } from '../../lib/forms/form-error.tsx'

/** What stands between this thing and being deleted, in the words a person needs. */
export interface DeleteObstacle {
  /** "This collection is not empty". */
  readonly title: string
  /** What is inside it, and the way out. */
  readonly body: ReactNode
  /** `danger` when the obstacle is that the contents could not be counted at all. */
  readonly tone?: 'warning' | 'danger'
  /** The label of the single button offered instead of Delete. */
  readonly action: string
}

/**
 * How the dialog is headed, and it is one or the other.
 *
 * Almost every use deletes a thing that has a name, and says so: `Delete
 * “Guides”?`. An act with its own word — revoking a share link is not
 * deleting a thing called something — gives the whole title instead, and
 * then there is no name to pass. Expressed as a pair so that neither can be
 * supplied pointlessly, which is what passing a `name` nothing renders was.
 */
export type ConfirmDeleteNaming =
  | { readonly name: string; readonly title?: undefined }
  | { readonly title: string; readonly name?: undefined }

export type ConfirmDeleteDialogProps = ConfirmDeleteDialogFields & ConfirmDeleteNaming

interface ConfirmDeleteDialogFields {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The destructive button's label, when "Delete" is not the word for it. */
  readonly confirmLabel?: string
  /** `nested` when this confirmation is opened from inside another dialog. */
  readonly elevation?: DialogElevation
  /** The rule, stated before the button is pressed rather than after. */
  readonly description: string
  /**
   * `undefined` when it can go. Anything else replaces Delete with one button
   * that closes, because a Delete that is certain to be refused is a control
   * that swallows a press (`docs/design/feedback.md`).
   */
  readonly obstacle?: DeleteObstacle | undefined
  /** True while the contents are still being counted; neither answer is known yet. */
  readonly checking?: boolean
  /** What is lost, when nothing is in the way. */
  readonly children: ReactNode
  readonly isPending: boolean
  /** An unexpected failure. The refusal a `obstacle` already explains is not passed here. */
  readonly error: unknown
  readonly onConfirm: () => void
}

/**
 * Deleting a thing that can only be deleted once it is empty.
 *
 * There were three of these — collections, units, workspaces — with the same
 * shape and the same rule: say what is inside before offering the button, and
 * do not offer it at all while something is. What differs is the sentence, the
 * count, and the write; everything else, including "a refused delete is not a
 * Delete button", is here.
 */
export function ConfirmDeleteDialog(props: ConfirmDeleteDialogProps) {
  const {
    open,
    onOpenChange,
    confirmLabel = 'Delete',
    elevation,
    description,
    obstacle,
    checking = false,
    children,
    isPending,
    error,
    onConfirm,
  } = props

  function close() {
    onOpenChange(false)
  }

  const heading = props.title ?? `Delete “${props.name}”?`
  const blocked = checking || obstacle !== undefined

  return (
    <Dialog
      title={heading}
      description={description}
      {...(elevation === undefined ? {} : { elevation })}
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      footer={
        blocked ? (
          <Button onClick={close}>{obstacle?.action ?? 'Close'}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" loading={isPending} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </>
        )
      }
    >
      {checking ? (
        <p aria-busy="true" className="flex items-center gap-2">
          <Spinner /> Checking what is in it
        </p>
      ) : obstacle === undefined ? (
        children
      ) : (
        <Callout tone={obstacle.tone ?? 'warning'} title={obstacle.title}>
          {obstacle.body}
        </Callout>
      )}
      <FormError error={error} />
    </Dialog>
  )
}
