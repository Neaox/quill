import { useState, type FormEvent } from 'react'

import { Button, Dialog, Input } from '@quill/ui'

import {
  ApiError,
  readUnitNotEmptyDetails,
  useCreateUnit,
  useDeleteUnit,
  useRenameUnit,
} from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { ConfirmDeleteDialog } from '../dialogs/confirm-delete-dialog.tsx'
import { RenameDialog } from '../dialogs/rename-dialog.tsx'

/**
 * Creating, renaming and deleting an organisational unit (use case 2).
 *
 * A unit is a private branch of the tree: creating one under a parent inherits
 * nothing but the grants that already reach that parent, and deleting one is
 * refused while it still holds anything, because the rows cascade and a
 * careless delete would take a whole body of documentation with it (ADR-012).
 */

export interface CreateUnitDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The unit this one goes under; omitted for a unit directly under the instance. */
  readonly parentId?: string | undefined
  readonly parentName?: string | undefined
  readonly onCreated?: (unitId: string) => void
}

export function CreateUnitDialog({
  open,
  onOpenChange,
  parentId,
  parentName,
  onCreated,
}: CreateUnitDialogProps) {
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const create = useCreateUnit()

  function close() {
    onOpenChange(false)
    setName('')
    setLabel('')
    create.reset()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') return
    const trimmedLabel = label.trim()
    create.mutate(
      {
        name: trimmed,
        ...(parentId === undefined ? {} : { parentId }),
        ...(trimmedLabel === '' ? {} : { label: trimmedLabel }),
      },
      {
        onSuccess: (unit) => {
          close()
          onCreated?.(unit.id)
        },
      },
    )
  }

  return (
    <Dialog
      title={parentName === undefined ? 'New unit' : `New unit in ${parentName}`}
      description="A unit is a company, a department, or a team: its own private branch of the organisation."
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
            form="new-unit-form"
            loading={create.isPending}
            disabled={name.trim() === ''}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="new-unit-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
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
          label="What you call this level"
          name="label"
          description="Your organisation's own word — company, division, team. Left blank, it is simply a unit."
          value={label}
          onChange={(event) => {
            setLabel(event.target.value)
          }}
        />
        <FormError error={create.error} />
      </form>
    </Dialog>
  )
}

export interface RenameUnitDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly unitId: string
  readonly currentName: string
}

export function RenameUnitDialog({
  open,
  onOpenChange,
  unitId,
  currentName,
}: RenameUnitDialogProps) {
  const rename = useRenameUnit()

  return (
    <RenameDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) rename.reset()
        onOpenChange(next)
      }}
      currentName={currentName}
      description="Only the name changes. Everything inside the unit stays where it is."
      isPending={rename.isPending}
      error={rename.error}
      onRename={(name) => {
        rename.mutate(
          { unitId, name },
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

export interface DeleteUnitDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly unitId: string
  readonly name: string
  /** What the tree already shows inside it, before the server is asked. */
  readonly workspaceCount: number
  readonly childUnitCount: number
}

function contentsSentence(workspaces: number, units: number): string {
  const parts = [
    workspaces === 1 ? 'one workspace' : workspaces > 1 ? `${String(workspaces)} workspaces` : '',
    units === 1 ? 'one unit' : units > 1 ? `${String(units)} units` : '',
  ].filter((part) => part !== '')
  return `It still holds ${parts.join(' and ')}.`
}

export function DeleteUnitDialog({
  open,
  onOpenChange,
  unitId,
  name,
  workspaceCount,
  childUnitCount,
}: DeleteUnitDialogProps) {
  const remove = useDeleteUnit()
  const refused =
    remove.error instanceof ApiError && remove.error.code === 'unit_not_empty'
      ? readUnitNotEmptyDetails(remove.error.details)
      : undefined
  const contents = refused ?? { workspaces: workspaceCount, units: childUnitCount }
  const blocked = contents.workspaces > 0 || contents.units > 0

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset()
        onOpenChange(next)
      }}
      name={name}
      description="A unit can only be deleted once nothing is inside it."
      {...(blocked
        ? {
            obstacle: {
              title: 'This unit is not empty',
              action: 'Empty it first',
              body: (
                <>
                  {contentsSentence(contents.workspaces, contents.units)} Delete or move what is
                  inside it first — deleting the unit would take all of it with it.
                </>
              ),
            },
          }
        : {})}
      isPending={remove.isPending}
      // The refusal the obstacle above already explains is not also an error.
      error={refused === undefined ? remove.error : null}
      onConfirm={() => {
        remove.mutate(unitId, {
          onSuccess: () => {
            onOpenChange(false)
          },
        })
      }}
    >
      <p>This unit is empty, so nothing is lost. Any grants made at it go with it.</p>
    </ConfirmDeleteDialog>
  )
}
