import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { ApiError } from '../../lib/api/index.ts'
import { ConfirmDeleteDialog } from './confirm-delete-dialog.tsx'
import { RenameDialog } from './rename-dialog.tsx'

/**
 * The two dialogs collections, units and workspaces all share
 * (review 2026-09-13, M7). What each caller supplies — the sentence, the
 * count, the write — is a prop; everything here is the part that used to be
 * written out three times apiece and could drift.
 */
function renderRename(overrides: Partial<Parameters<typeof RenameDialog>[0]> = {}) {
  const onRename = vi.fn<(name: string) => void>()
  const onOpenChange = vi.fn<(open: boolean) => void>()
  const view = render(
    <RenameDialog
      open
      onOpenChange={onOpenChange}
      currentName="Guides"
      description="Only the name changes."
      isPending={false}
      error={null}
      onRename={onRename}
      {...overrides}
    />,
  )
  return { ...view, onRename, onOpenChange }
}

function renderDelete(overrides: Partial<Parameters<typeof ConfirmDeleteDialog>[0]> = {}) {
  const onConfirm = vi.fn<() => void>()
  const onOpenChange = vi.fn<(open: boolean) => void>()
  const view = render(
    <ConfirmDeleteDialog
      open
      onOpenChange={onOpenChange}
      name="Guides"
      description="A collection can only be deleted once it is empty."
      isPending={false}
      error={null}
      onConfirm={onConfirm}
      {...overrides}
    >
      <p>This collection is empty, so nothing is lost.</p>
    </ConfirmDeleteDialog>,
  )
  return { ...view, onConfirm, onOpenChange }
}

describe('RenameDialog', () => {
  it('names what is being renamed, and seeds the field with it', async () => {
    renderRename()

    const dialog = screen.getByRole('dialog', { name: /Rename .Guides/ })
    expect(within(dialog).getByRole('textbox', { name: /Name/ })).toHaveValue('Guides')
    // The dialog itself, not the whole document: Radix's focus guards live
    // outside it and axe reads them as focusable `aria-hidden` content.
    await expectNoAccessibilityViolations(dialog)
  })

  it('renames with the trimmed name', async () => {
    const { onRename } = renderRename()
    const field = screen.getByRole('textbox', { name: /Name/ })

    await userEvent.clear(field)
    await userEvent.type(field, '  Runbooks  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onRename).toHaveBeenCalledExactlyOnceWith('Runbooks')
  })

  it('closes without a request when the name has not actually changed', async () => {
    const { onRename, onOpenChange } = renderRename()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onRename).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('refuses an empty name at the control rather than at the server', async () => {
    renderRename()

    await userEvent.clear(screen.getByRole('textbox', { name: /Name/ }))

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('cancels back to the name it opened with', async () => {
    const { onOpenChange } = renderRename()
    const field = screen.getByRole('textbox', { name: /Name/ })

    await userEvent.clear(field)
    await userEvent.type(field, 'Something else')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(field).toHaveValue('Guides')
  })

  it('keeps the control busy while the write is in flight, and shows a failure inline', () => {
    const { rerender } = renderRename({ isPending: true })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true')

    rerender(
      <RenameDialog
        open
        onOpenChange={() => {}}
        currentName="Guides"
        description="Only the name changes."
        isPending={false}
        error={new ApiError(409, { code: 'name_taken', message: 'That name is taken' })}
        onRename={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('That name is taken')
  })
})

describe('ConfirmDeleteDialog', () => {
  it('offers Delete, and says what is lost, when nothing is in the way', async () => {
    const { onConfirm } = renderDelete()

    expect(screen.getByText('This collection is empty, so nothing is lost.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    await expectNoAccessibilityViolations(screen.getByRole('dialog'))
  })

  /*
   * `docs/design/feedback.md`: a control that can be pressed always does
   * something. A Delete that is certain to be refused is not offered at all.
   */
  it('replaces Delete with the one way out when something is in the way', async () => {
    const { onConfirm, onOpenChange } = renderDelete({
      obstacle: {
        title: 'This collection is not empty',
        action: 'Move documents first',
        body: <>It still holds one document.</>,
      },
    })

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByText('It still holds one document.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Move documents first' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('says so while it is still counting, rather than offering a delete on a guess', () => {
    renderDelete({ checking: true })

    expect(screen.getByText('Checking what is in it')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('takes a danger tone for an obstacle that is an unknown rather than a count', () => {
    renderDelete({
      obstacle: {
        title: "Couldn't check what is in it",
        action: 'Close',
        tone: 'danger',
        body: <>Nothing is deleted while this is unknown.</>,
      },
    })

    expect(screen.getByRole('group', { name: /Couldn.t check what is in it/ })).toBeInTheDocument()
  })

  it('cancels, and shows an unexpected failure inline', async () => {
    const { onOpenChange, rerender } = renderDelete()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    rerender(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        name="Guides"
        description="A collection can only be deleted once it is empty."
        isPending
        error={new ApiError(500, { code: 'internal_error', message: 'Nothing was deleted' })}
        onConfirm={() => {}}
      >
        <p>Empty.</p>
      </ConfirmDeleteDialog>,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Nothing was deleted')
    })
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('aria-busy', 'true')
  })
})
