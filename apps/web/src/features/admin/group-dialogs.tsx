import { useState, type FormEvent } from 'react'

import { Button, Dialog, Input, toast } from '@quill/ui'

import {
  ApiError,
  useAllUnits,
  useCreateGroup,
  useDeleteGroup,
  useRenameGroup,
  type GroupSummaryDto,
  type UnitDto,
} from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { SelectField } from '../../lib/forms/select-field.tsx'
import { ConfirmDeleteDialog } from '../dialogs/confirm-delete-dialog.tsx'
import { RenameDialog } from '../dialogs/rename-dialog.tsx'

/**
 * Creating, renaming and deleting a group.
 *
 * A group is a set of people a grant can name, so each of these changes who
 * can read what; the delete dialog says what goes with the group before it
 * offers the button, and refuses to offer it at all while other groups nest
 * inside (ADR-052).
 */

const NO_PARENT = ''

/** "Acme / Platform": a unit's name under the names above it, from the flat list. */
function unitPaths(units: readonly UnitDto[]): ReadonlyMap<string, string> {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const pathOf = (unit: UnitDto, depth = 0): string => {
    const parent = unit.parentId === null ? undefined : byId.get(unit.parentId)
    return parent === undefined || depth > 32
      ? unit.name
      : `${pathOf(parent, depth + 1)} / ${unit.name}`
  }
  return new Map(units.map((unit) => [unit.id, pathOf(unit)]))
}

export interface CreateGroupDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** Every group, to offer the ones a new group can nest inside. */
  readonly groups: readonly GroupSummaryDto[]
  /** What the dialog opens on: the unit, and the group to nest in, if the screen has a selection. */
  readonly initialUnitId?: string | undefined
  readonly initialParentGroupId?: string | undefined
  readonly onCreated?: (groupId: string) => void
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  groups,
  initialUnitId,
  initialParentGroupId,
  onCreated,
}: CreateGroupDialogProps) {
  const units = useAllUnits({ enabled: open })
  const create = useCreateGroup()
  const [name, setName] = useState('')
  const [chosenUnitId, setChosenUnitId] = useState<string | undefined>(undefined)
  const [chosenParentId, setChosenParentId] = useState<string | undefined>(undefined)

  const paths = unitPaths(units.data ?? [])
  const sortedUnits = [...paths].toSorted(([, a], [, b]) => a.localeCompare(b))
  // The only unit there is needs no choosing; otherwise start where the screen is.
  const unitId =
    chosenUnitId ??
    initialUnitId ??
    (sortedUnits.length === 1 ? sortedUnits[0]?.[0] : undefined) ??
    ''
  const parentCandidates = groups.filter((group) => group.unitId === unitId)
  const requestedParent = chosenParentId ?? initialParentGroupId ?? NO_PARENT
  const parentGroupId = parentCandidates.some((group) => group.id === requestedParent)
    ? requestedParent
    : NO_PARENT

  function close() {
    onOpenChange(false)
    setName('')
    setChosenUnitId(undefined)
    setChosenParentId(undefined)
    create.reset()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '' || unitId === '') return
    create.mutate(
      { unitId, name: trimmed, ...(parentGroupId === NO_PARENT ? {} : { parentGroupId }) },
      {
        onSuccess: (group) => {
          close()
          onCreated?.(group.id)
        },
      },
    )
  }

  return (
    <Dialog
      title="New group"
      description="A group is a set of people. Give it access once and everyone in it has it."
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
            form="new-group-form"
            loading={create.isPending}
            disabled={name.trim() === '' || unitId === ''}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="new-group-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          label="Name"
          name="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <SelectField
          label="Unit"
          name="unitId"
          required
          description="A group belongs to one unit, and can be given access to anything in it."
          value={unitId}
          disabled={units.isPending}
          onChange={(event) => {
            setChosenUnitId(event.target.value)
            setChosenParentId(NO_PARENT)
          }}
        >
          <option value="" disabled>
            {units.isPending ? 'Loading units…' : 'Choose a unit'}
          </option>
          {sortedUnits.map(([id, path]) => (
            <option key={id} value={id}>
              {path}
            </option>
          ))}
        </SelectField>
        {parentCandidates.length === 0 ? undefined : (
          <SelectField
            label="Inside another group (optional)"
            name="parentGroupId"
            description="Access given to the outer group reaches the people in this one as well."
            value={parentGroupId}
            onChange={(event) => {
              setChosenParentId(event.target.value)
            }}
          >
            <option value={NO_PARENT}>Not inside another group</option>
            {parentCandidates.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </SelectField>
        )}
        {units.isError ? <FormError error={units.error} /> : undefined}
        <FormError error={create.error} />
      </form>
    </Dialog>
  )
}

export interface RenameGroupDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly groupId: string
  readonly currentName: string
}

export function RenameGroupDialog({
  open,
  onOpenChange,
  groupId,
  currentName,
}: RenameGroupDialogProps) {
  const rename = useRenameGroup()

  return (
    <RenameDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) rename.reset()
        onOpenChange(next)
      }}
      currentName={currentName}
      description="Only the name changes. Its members and the access it has stay exactly as they are."
      isPending={rename.isPending}
      error={rename.error}
      onRename={(name) => {
        rename.mutate(
          { groupId, name },
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

export interface DeleteGroupDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly group: GroupSummaryDto
  /** How many groups nest directly inside it, which the list already knows. */
  readonly nestedGroupCount: number
  readonly onDeleted?: () => void
}

const peopleCount = (count: number) => `${String(count)} ${count === 1 ? 'person' : 'people'}`

export function DeleteGroupDialog({
  open,
  onOpenChange,
  group,
  nestedGroupCount,
  onDeleted,
}: DeleteGroupDialogProps) {
  const remove = useDeleteGroup()
  // A refusal from the server (somebody nested a group a moment ago) is the same obstacle.
  const refused = remove.error instanceof ApiError && remove.error.code === 'group_has_children'
  const blocked = nestedGroupCount > 0 || refused

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset()
        onOpenChange(next)
      }}
      name={group.name}
      description="Deleting a group removes the access it was given. It does not delete any person."
      {...(blocked
        ? {
            obstacle: {
              title: 'Other groups are inside this one',
              action: 'Delete those first',
              body: (
                <>
                  {nestedGroupCount === 1
                    ? 'One group is nested inside it.'
                    : nestedGroupCount > 1
                      ? `${String(nestedGroupCount)} groups are nested inside it.`
                      : 'A group has been nested inside it.'}{' '}
                  Delete or move those first, so none of them is left without the group it sat in.
                </>
              ),
            },
          }
        : {})}
      isPending={remove.isPending}
      error={refused ? null : remove.error}
      onConfirm={() => {
        remove.mutate(
          { groupId: group.id },
          {
            onSuccess: (gone) => {
              onOpenChange(false)
              toast.success(`Deleted “${group.name}”`, {
                description: `${peopleCount(gone.members)} left it, and ${String(gone.grants)} ${gone.grants === 1 ? 'grant' : 'grants'} that named it ${gone.grants === 1 ? 'was' : 'were'} removed.`,
              })
              onDeleted?.()
            },
          },
        )
      }}
    >
      <p>
        {group.memberCount === 0
          ? 'Nobody is in this group.'
          : `${peopleCount(group.memberCount)} will no longer be in it.`}{' '}
        Every grant that gives this group access to something is removed with it, so anyone who had
        access only through this group loses it. The people themselves, and any access they hold
        another way, are not affected.
      </p>
    </ConfirmDeleteDialog>
  )
}
