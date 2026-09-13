import { useState, type FormEvent } from 'react'

import { Button, Dialog, Input } from '@quill/ui'

import {
  ApiError,
  readDocumentCount,
  useCreateCollection,
  useDeleteCollection,
  useRenameCollection,
} from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { ConfirmDeleteDialog } from '../dialogs/confirm-delete-dialog.tsx'
import { RenameDialog } from '../dialogs/rename-dialog.tsx'

/**
 * Creating, renaming and deleting a collection — the three writes
 * `docs/architecture/api-contract-m2.md` gives them, each as a dialog opened
 * from the place the collection is shown: the sidebar's workspace heading,
 * and each collection's own overflow menu.
 *
 * A collection is a permission scope, not a folder (ADR-012), which is why
 * none of these three is a rename of a path: creating one derives the slug
 * from the name and renaming one leaves the slug exactly as it was, so no
 * link and no published address can be broken by anything here.
 */

export interface CreateCollectionDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly workspaceId: string
  /** Called with the new collection's id, for a caller that wants to go there. */
  readonly onCreated?: (collectionId: string) => void
}

export function CreateCollectionDialog({
  open,
  onOpenChange,
  workspaceId,
  onCreated,
}: CreateCollectionDialogProps) {
  const [name, setName] = useState('')
  const create = useCreateCollection()

  function close() {
    onOpenChange(false)
    setName('')
    create.reset()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') return
    create.mutate(
      { workspaceId, name: trimmed },
      {
        onSuccess: (collection) => {
          close()
          onCreated?.(collection.id)
        },
      },
    )
  }

  return (
    <Dialog
      title="New collection"
      description="A collection holds documents, and carries its own access and publishing settings."
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-collection-form"
            loading={create.isPending}
            disabled={name.trim() === ''}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="new-collection-form" onSubmit={handleSubmit} noValidate>
        <Input
          label="Name"
          name="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <FormError error={create.error} />
      </form>
    </Dialog>
  )
}

export interface RenameCollectionDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly collectionId: string
  readonly currentName: string
}

export function RenameCollectionDialog({
  open,
  onOpenChange,
  collectionId,
  currentName,
}: RenameCollectionDialogProps) {
  const rename = useRenameCollection()

  return (
    <RenameDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) rename.reset()
        onOpenChange(next)
      }}
      currentName={currentName}
      description="Only the name changes. Nothing points at a collection by its address, so nothing can break."
      isPending={rename.isPending}
      error={rename.error}
      onRename={(name) => {
        rename.mutate(
          { collectionId, name },
          {
            onSuccess: () => {
              onOpenChange(false)
            },
          },
        )
      }}
    />
  )
}

export interface DeleteCollectionDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly workspaceId: string
  readonly collectionId: string
  readonly name: string
  /** How many documents the navigation currently shows in it, before asking the server. */
  readonly documentCount: number
}

function notEmptyMessage(count: number): string {
  return count === 1 ? 'It still holds one document.' : `It still holds ${String(count)} documents.`
}

/**
 * Deleting a collection, which the server allows only when it is empty (`409
 * collection_not_empty`, with the count in `details.documents`). The reason
 * is on screen before the button is pressed when the navigation already knows
 * the count, and again from the server's own answer when it does not — a
 * collection can have filled up in another tab — and the way out is the same
 * either way: move the documents somewhere else first.
 */
export function DeleteCollectionDialog({
  open,
  onOpenChange,
  workspaceId,
  collectionId,
  name,
  documentCount,
}: DeleteCollectionDialogProps) {
  const remove = useDeleteCollection()
  const refused =
    remove.error instanceof ApiError && remove.error.code === 'collection_not_empty'
      ? (readDocumentCount(remove.error.details) ?? documentCount)
      : undefined
  const blockedCount = refused ?? (documentCount > 0 ? documentCount : undefined)

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset()
        onOpenChange(next)
      }}
      name={name}
      description="A collection can only be deleted once it is empty."
      {...(blockedCount === undefined
        ? {}
        : {
            obstacle: {
              title: 'This collection is not empty',
              action: 'Move documents first',
              body: (
                <>
                  {notEmptyMessage(blockedCount)} Move them to another collection — each
                  document&rsquo;s &ldquo;Move to…&rdquo; does it — or delete them, and then this
                  collection can go.
                </>
              ),
            },
          })}
      isPending={remove.isPending}
      // The refusal the obstacle above already explains is not also an error.
      error={refused === undefined ? remove.error : null}
      onConfirm={() => {
        remove.mutate(
          { collectionId, workspaceId },
          {
            onSuccess: () => {
              onOpenChange(false)
            },
          },
        )
      }}
    >
      <p>
        This collection is empty, so nothing is lost. Its access and publishing settings go with it.
      </p>
    </ConfirmDeleteDialog>
  )
}
