import { useState } from 'react'

import { Button, Dialog, DataTable, Spinner, toast, tv } from '@quill/ui'

import { ApiError } from '../../lib/api/index.ts'
import { useAttachments, useDeleteAttachment, type Attachment } from '../../lib/api/attachments.ts'
import { ConfirmDeleteDialog } from '../dialogs/confirm-delete-dialog.tsx'
import type { DeleteObstacle } from '../dialogs/confirm-delete-dialog.tsx'

/**
 * What a document carries, and the way to take one down.
 *
 * Uploading happens in the editor, where a picture is being placed; this is
 * the other half — the list, for the questions the editor cannot answer. What
 * is in this document? Who put that there, and when? How much of our storage
 * is this runbook's screenshots? And: this one is wrong, take it away.
 *
 * A delete is refused while a published document still shows the file, and the
 * refusal is the interesting part rather than an error: it names what to do,
 * which is to take the picture out of the document and publish. So it is shown
 * where the button was pressed rather than as a toast that floats away from it.
 */

export const attachmentsPanelStyles = tv({
  slots: {
    pending: 'flex items-center gap-2 py-6 text-xs text-muted',
    empty: 'py-6 text-xs text-muted',
    name: 'text-start font-normal text-foreground',
    meta: 'block text-2xs text-muted',
  },
})

export interface AttachmentsPanelProps {
  readonly documentId: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** Whether this person may take one down; `edit` on the document (ADR-012). */
  readonly canEdit: boolean
}

const KILOBYTE = 1024
const MEGABYTE = KILOBYTE * KILOBYTE

/** A size in the unit a person would say it in. */
export function fileSize(bytes: number): string {
  if (bytes >= MEGABYTE) return `${(bytes / MEGABYTE).toFixed(1)} MB`
  if (bytes >= KILOBYTE) return `${Math.round(bytes / KILOBYTE)} KB`
  return `${bytes} bytes`
}

/** `image/png` reads as `PNG`; `application/pdf` as `PDF`. */
export function typeLabel(contentType: string): string {
  const [, subtype = contentType] = contentType.split('/')
  return subtype.toUpperCase()
}

export function AttachmentsPanel({
  documentId,
  open,
  onOpenChange,
  canEdit,
}: AttachmentsPanelProps) {
  const attachments = useAttachments(documentId)
  const remove = useDeleteAttachment()
  const [removing, setRemoving] = useState<Attachment | undefined>(undefined)
  const styles = attachmentsPanelStyles()

  function close() {
    onOpenChange(false)
  }

  return (
    <>
      <Dialog
        title="Attachments"
        description="The files this document carries. Uploading one happens in the editor, where it is placed."
        open={open}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        footer={<Button onClick={close}>Close</Button>}
      >
        {attachments.isPending ? (
          <p aria-busy="true" className={styles.pending()}>
            <Spinner /> Loading what this document carries
          </p>
        ) : attachments.data === undefined || attachments.data.length === 0 ? (
          <p className={styles.empty()}>
            Nothing yet. Drag a picture onto the document while you are writing, or use the image
            control in the editor.
          </p>
        ) : (
          <DataTable label="Attachments">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Added</th>
                {canEdit ? (
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : undefined}
              </tr>
            </thead>
            <tbody>
              {attachments.data.map((row) => (
                <tr key={row.id}>
                  {/*
                    The name is the cell's own text rather than a span inside a
                    span: a row header reads as what it names, and the type and
                    size sit under it as the detail they are.
                  */}
                  <th scope="row" className={styles.name()}>
                    {row.filename}
                    <span className={styles.meta()}>
                      {typeLabel(row.contentType)} · {fileSize(row.size)}
                    </span>
                  </th>
                  <td>
                    <time dateTime={row.createdAt}>
                      {new Date(row.createdAt).toLocaleDateString()}
                    </time>
                  </td>
                  {canEdit ? (
                    <td>
                      {/*
                        The label a screen reader hears names the file; the one
                        on screen does not repeat what the row already says.
                      */}
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Delete ${row.filename}`}
                        onClick={() => {
                          remove.reset()
                          setRemoving(row)
                        }}
                      >
                        Delete…
                      </Button>
                    </td>
                  ) : undefined}
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Dialog>

      <ConfirmDeleteDialog
        open={removing !== undefined}
        onOpenChange={(next) => {
          if (!next) setRemoving(undefined)
        }}
        name={removing?.filename ?? ''}
        description="The file stops being served. Documents that still show it are not changed."
        obstacle={inUse(remove.error)}
        isPending={remove.isPending}
        // The refusal is explained by `obstacle`; anything else is an error.
        error={inUse(remove.error) === undefined ? remove.error : undefined}
        onConfirm={() => {
          if (removing === undefined) return
          remove.mutate(
            { attachmentId: removing.id, documentId },
            {
              onSuccess: () => {
                toast.success(`Deleted ${removing.filename}`)
                setRemoving(undefined)
              },
            },
          )
        }}
      >
        <p>Nothing else points at it once it is gone, and it cannot be brought back from here.</p>
      </ConfirmDeleteDialog>
    </>
  )
}

/**
 * The one refusal that is a rule rather than a fault, read out of the error.
 *
 * `attachment_in_use` means a published document still shows this file, and
 * the way out is in the document rather than in this dialog — so it replaces
 * the Delete button rather than appearing beside it.
 */
export function inUse(error: unknown): DeleteObstacle | undefined {
  if (!(error instanceof ApiError) || error.code !== 'attachment_in_use') return undefined
  const { named, hidden } = readCounts(error.details)

  return {
    title: 'A published document still shows this file',
    body: (
      <>
        {describe(named, hidden)} Take the picture out of the document, publish, and delete the file
        then.
      </>
    ),
    action: 'Close',
  }
}

/**
 * The two numbers out of the refusal's detail, without trusting its shape.
 *
 * The server sends them, but `details` is `unknown` to a client by design, and
 * an older or newer server is a thing this one meets; anything missing reads as
 * nothing rather than as a crash.
 */
function readCounts(details: unknown): { named: number; hidden: number } {
  if (typeof details !== 'object' || details === null) return { named: 0, hidden: 0 }
  const documents = 'documents' in details ? details.documents : undefined
  const hidden = 'hidden' in details ? details.hidden : undefined
  return {
    named: Array.isArray(documents) ? documents.length : 0,
    hidden: typeof hidden === 'number' ? hidden : 0,
  }
}

function describe(named: number, hidden: number): string {
  if (named > 0 && hidden > 0) {
    return `${count(named)} you can open, and ${count(hidden)} you cannot.`
  }
  if (hidden > 0) return `${count(hidden)} you cannot open shows it.`
  return `${count(named)} shows it.`
}

function count(value: number): string {
  return value === 1 ? '1 document' : `${value} documents`
}
