import { useState, type FormEvent } from 'react'

import { Button, Dialog, Input } from '@quill/ui'

import { FormError } from '../../lib/forms/form-error.tsx'

export interface RenameDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The name as it stands. Also what the field is seeded with. */
  readonly currentName: string
  /**
   * What renaming does *not* change, which is the reassurance every one of
   * these owes: a collection's address, a unit's contents, a workspace's
   * published site.
   */
  readonly description: string
  readonly isPending: boolean
  readonly error: unknown
  /**
   * Called with a trimmed name that is neither empty nor the current one — a
   * rename that changes nothing closes the dialog without a request. Closing
   * on success is the caller's, because only it knows when the write landed.
   */
  readonly onRename: (name: string) => void
}

/**
 * Renaming a thing that has a name.
 *
 * There were three of these — collections, units, workspaces — identical but
 * for one sentence and one mutation, which is three places for a fix to be
 * applied twice and forgotten once. What actually differs between them is the
 * description and the write, so those are the props; the field, the trimming,
 * the no-op case, the pending button and the inline error are here.
 */
export function RenameDialog({
  open,
  onOpenChange,
  currentName,
  description,
  isPending,
  error,
  onRename,
}: RenameDialogProps) {
  const [name, setName] = useState(currentName)
  const formId = 'rename-form'

  function close() {
    onOpenChange(false)
    setName(currentName)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    // A rename to the same name, or to nothing, is not a rename: it closes
    // rather than sending a request whose only possible answer is "unchanged".
    if (trimmed === '' || trimmed === currentName) {
      close()
      return
    }
    onRename(trimmed)
  }

  return (
    <Dialog
      title={`Rename “${currentName}”`}
      description={description}
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={isPending} disabled={name.trim() === ''}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate>
        <Input
          label="Name"
          name="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <FormError error={error} />
      </form>
    </Dialog>
  )
}
