import { useNavigate } from '@tanstack/react-router'

import { Button, Callout, Dialog, toast } from '@quill/ui'

import { useDeleteDocument } from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'

export interface DeleteDocumentDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly workspaceSlug: string
  readonly workspaceId: string
  readonly documentId: string
  readonly title: string
  /** How many documents are nested directly under this one, from the tree. */
  readonly childCount: number
}

function childrenSentence(count: number): string {
  return count === 1
    ? 'The document nested under it is not deleted: it moves up to the top level of its collection.'
    : `The ${String(count)} documents nested under it are not deleted: they move up to the top level of their collection.`
}

/**
 * Deleting a document.
 *
 * A blocking dialog, because it cannot be undone: there is no restore route
 * for a deleted document in M2, which is also why the toast that follows
 * carries no Undo. It names the document, and — this is the part a person
 * needs before they press it — says what becomes of anything nested under it.
 * The server sets those children's parent to null rather than deleting them,
 * so they are lifted to the top level of their collection, and that is what
 * this says, rather than a general warning about "children".
 *
 * Afterwards the person is somewhere real: the workspace home, with the tree
 * already redrawn without the document.
 */
export function DeleteDocumentDialog({
  open,
  onOpenChange,
  workspaceSlug,
  workspaceId,
  documentId,
  title,
  childCount,
}: DeleteDocumentDialogProps) {
  const remove = useDeleteDocument()
  const navigate = useNavigate()

  function close() {
    onOpenChange(false)
    remove.reset()
  }

  function confirm() {
    remove.mutate(
      { documentId, workspaceId },
      {
        onSuccess: () => {
          close()
          void navigate({ to: '/w/$workspaceSlug', params: { workspaceSlug } })
          // A moment, after the page it belonged to has gone: exactly what a
          // toast is for (`docs/design/feedback.md`). No action, because
          // there is no route that could restore it.
          toast.show({ title: `Deleted ${title}` })
        },
      },
    )
  }

  return (
    <Dialog
      title={`Delete “${title}”?`}
      description="This cannot be undone."
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={confirm}>
            Delete
          </Button>
        </>
      }
    >
      <p>
        The document and every revision of it go. Nothing restores a deleted document, so this is
        the end of it.
      </p>
      {childCount === 0 ? undefined : (
        <Callout tone="info" title="What happens to what is nested under it">
          {childrenSentence(childCount)}
        </Callout>
      )}
      <FormError error={remove.error} />
    </Dialog>
  )
}
