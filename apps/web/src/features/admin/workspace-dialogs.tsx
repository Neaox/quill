import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { Button, Dialog, Input } from '@quill/ui'

import {
  useCreateWorkspace,
  useDeleteWorkspace,
  useDocuments,
  useRenameWorkspace,
} from '../../lib/api/index.ts'
import { slugify } from '../../lib/documents/slugify.ts'
import { workspaceReference } from '../../lib/routing/document-reference.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { ConfirmDeleteDialog } from '../dialogs/confirm-delete-dialog.tsx'
import { RenameDialog } from '../dialogs/rename-dialog.tsx'

/**
 * Creating, renaming and deleting a workspace (use case 3).
 *
 * The address a workspace is published at is its slug, which is unique across
 * the instance, so it is a field a person can see and change rather than
 * something derived silently: it is suggested from the name and left alone
 * once it has been typed in.
 */

export interface CreateWorkspaceDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly unitId: string
  readonly unitName: string
  /** Opens the new workspace once it exists, which is where a person wants to be. */
  readonly openOnCreate?: boolean
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  unitId,
  unitName,
  openOnCreate = true,
}: CreateWorkspaceDialogProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const create = useCreateWorkspace()
  const navigate = useNavigate()

  // Derived, not synchronised by an effect (AGENTS.md rule 6): the suggestion
  // follows the name until somebody types an address of their own.
  const effectiveSlug = slugEdited ? slug : slugify(name)

  function close() {
    onOpenChange(false)
    setName('')
    setSlug('')
    setSlugEdited(false)
    create.reset()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '' || effectiveSlug === '') return
    create.mutate(
      { unitId, name: trimmed, slug: effectiveSlug },
      {
        onSuccess: (workspace) => {
          close()
          if (openOnCreate) {
            void navigate({
              to: '/w/$workspaceSlug',
              params: { workspaceSlug: workspaceReference(workspace) },
            })
          }
        },
      },
    )
  }

  return (
    <Dialog
      title={`New workspace in ${unitName}`}
      description="A workspace is where a team writes: collections, documents, and its own front page."
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
            form="new-workspace-form"
            loading={create.isPending}
            disabled={name.trim() === '' || effectiveSlug === ''}
          >
            Create
          </Button>
        </>
      }
    >
      <form
        id="new-workspace-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <Input
          label="Name"
          name="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <Input
          label="Address"
          name="slug"
          required
          description="Lower-case words joined by hyphens. This is what a published site will be addressed by."
          value={effectiveSlug}
          onChange={(event) => {
            setSlugEdited(true)
            setSlug(event.target.value)
          }}
        />
        <FormError error={create.error} />
      </form>
    </Dialog>
  )
}

export interface RenameWorkspaceDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly workspaceId: string
  readonly currentName: string
}

export function RenameWorkspaceDialog({
  open,
  onOpenChange,
  workspaceId,
  currentName,
}: RenameWorkspaceDialogProps) {
  const rename = useRenameWorkspace()

  return (
    <RenameDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) rename.reset()
        onOpenChange(next)
      }}
      currentName={currentName}
      description="Only the name changes; the address stays as it is, so nothing published moves."
      isPending={rename.isPending}
      error={rename.error}
      onRename={(name) => {
        rename.mutate(
          { workspaceId, name },
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

export interface DeleteWorkspaceDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly workspaceId: string
  readonly name: string
}

/**
 * Deleting a workspace.
 *
 * The server does **not** refuse a workspace that still holds documents: the
 * row cascades to its collections, documents, drafts and revisions. So this
 * dialog is what keeps "delete an empty one" true — it counts the documents
 * first and offers the button only when there are none, rather than asking a
 * person to type the name and hoping they meant it.
 */
export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspaceId,
  name,
}: DeleteWorkspaceDialogProps) {
  const documents = useDocuments(open ? workspaceId : undefined)
  const remove = useDeleteWorkspace()
  const count = documents.data?.length ?? 0

  /*
   * Three answers, not two: it holds documents, it holds none, or nobody
   * knows. The last one is an obstacle of its own — nothing is deleted while
   * the contents are unknown — rather than a delete offered on a guess.
   */
  const obstacle =
    count > 0
      ? {
          title: 'This workspace is not empty',
          action: 'Empty it first',
          body: (
            <>
              {count === 1
                ? 'It still holds one document.'
                : `It still holds ${String(count)} documents.`}{' '}
              Deleting it would take every document, draft and revision with it, so delete them
              first if that is really what you want.
            </>
          ),
        }
      : documents.isError
        ? {
            title: "Couldn't check what is in it",
            action: 'Close',
            tone: 'danger' as const,
            body: <>Nothing is deleted while this is unknown. Reload the page and try again.</>,
          }
        : undefined

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset()
        onOpenChange(next)
      }}
      name={name}
      description="A workspace can only be deleted once it is empty."
      checking={documents.isPending}
      {...(obstacle === undefined ? {} : { obstacle })}
      isPending={remove.isPending}
      error={remove.error}
      onConfirm={() => {
        remove.mutate(workspaceId, {
          onSuccess: () => {
            onOpenChange(false)
          },
        })
      }}
    >
      <p>This workspace has no documents, so nothing is lost. Its collections go with it.</p>
    </ConfirmDeleteDialog>
  )
}
