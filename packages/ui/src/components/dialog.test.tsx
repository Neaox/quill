import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Button } from './button.tsx'
import { Dialog, DialogClose } from './dialog.tsx'

describe('Dialog', () => {
  it('is closed until its trigger is used', async () => {
    render(
      <Dialog title="Delete document" trigger={<Button>Delete</Button>}>
        This cannot be undone.
      </Dialog>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('dialog', { name: 'Delete document' })).toBeInTheDocument()
  })

  it('is named by its title and described by its description', async () => {
    render(
      <Dialog
        open
        title="Delete document"
        description="The document and its revisions are removed."
      >
        Body.
      </Dialog>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Delete document' })
    expect(dialog).toHaveAccessibleDescription('The document and its revisions are removed.')
    await expectNoAccessibilityViolations(dialog)
  })

  it('takes a description with markup, and is described by its text', async () => {
    render(
      <Dialog
        open
        title="Preview"
        description={
          <>
            <strong>3</strong> to check
          </>
        }
      >
        Body.
      </Dialog>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Preview' })
    expect(dialog).toHaveAccessibleDescription('3 to check')
    await expectNoAccessibilityViolations(dialog)
  })

  it('carries no dangling description when none is given', async () => {
    render(
      <Dialog open title="Delete document">
        Body.
      </Dialog>,
    )

    const dialog = await screen.findByRole('dialog')
    expect(dialog).not.toHaveAttribute('aria-describedby')
    await expectNoAccessibilityViolations(dialog)
  })

  it('moves focus into the panel and traps it there', async () => {
    render(
      <Dialog
        open
        title="Delete document"
        footer={
          <>
            <DialogClose>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="danger">Delete</Button>
          </>
        }
      >
        This cannot be undone.
      </Dialog>,
    )

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    // Tabbing all the way round returns into the dialog rather than escaping it.
    const visited: boolean[] = []
    await userEvent.tab()
    visited.push(dialog.contains(document.activeElement))
    await userEvent.tab()
    visited.push(dialog.contains(document.activeElement))
    await userEvent.tab()
    visited.push(dialog.contains(document.activeElement))
    await userEvent.tab()
    visited.push(dialog.contains(document.activeElement))
    await userEvent.tab()
    visited.push(dialog.contains(document.activeElement))
    await userEvent.tab({ shift: true })
    visited.push(dialog.contains(document.activeElement))

    expect(visited).toEqual([true, true, true, true, true, true])
  })

  it('closes on Escape and reports the change', async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>()
    render(
      <Dialog open onOpenChange={onOpenChange} title="Delete document">
        Body.
      </Dialog>,
    )

    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes through its labelled close control', async () => {
    render(
      <Dialog title="Delete document" trigger={<Button>Delete</Button>}>
        Body.
      </Dialog>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('returns focus to the trigger when it closes', async () => {
    render(
      <Dialog title="Delete document" trigger={<Button>Delete</Button>}>
        Body.
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Delete' })
    await userEvent.click(trigger)
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(trigger).toHaveFocus()
    })
  })

  it('lets the caller send focus somewhere other than the trigger when it closes', async () => {
    const elsewhere = vi.fn<(event: Event) => void>((event) => {
      event.preventDefault()
      screen.getByRole('button', { name: 'Elsewhere' }).focus()
    })
    render(
      <>
        <Dialog
          title="Delete document"
          trigger={<Button>Delete</Button>}
          onCloseAutoFocus={elsewhere}
        >
          Body.
        </Dialog>
        <Button>Elsewhere</Button>
      </>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
    })
    expect(elsewhere).toHaveBeenCalledOnce()
  })

  it('closes from a footer action wrapped in DialogClose', async () => {
    render(
      <Dialog
        title="Delete document"
        trigger={<Button>Delete</Button>}
        footer={
          <DialogClose>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
        }
      >
        Body.
      </Dialog>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('dialog')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('accepts a caller-supplied close label and extra classes', async () => {
    render(
      <Dialog open title="Delete document" closeLabel="Dismiss" className="max-w-sm">
        Body.
      </Dialog>,
    )

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(dialog).toHaveClass('max-w-sm')
  })

  it('raises a dialog opened from inside another one above it', async () => {
    render(
      <Dialog open title="Revoke this link?" elevation="nested">
        Body.
      </Dialog>,
    )

    // A modal earns its press by suspending what is behind it, and the
    // dimming is how that is said — so a second dialog's overlay has to paint
    // above the first one's panel, not beneath it.
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveClass('z-70')
    expect(document.querySelector('.dialog-overlay')).toHaveClass('z-60')
  })

  it('rises from the bottom edge as a sheet, clear of the home indicator', async () => {
    render(
      <Dialog open title="Preview" placement="sheet">
        Body.
      </Dialog>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Preview' })
    expect(dialog).toHaveClass('dialog-sheet', 'bottom-0', 'inset-x-0')
    expect(dialog).not.toHaveClass('dialog-panel')
    expect(dialog.className).toContain('safe-area-inset-bottom')
    await expectNoAccessibilityViolations(dialog)
  })

  it('is centred unless asked otherwise', async () => {
    render(
      <Dialog open title="Rename">
        Body.
      </Dialog>,
    )

    expect(await screen.findByRole('dialog')).toHaveClass('dialog-panel', 'top-1/2')
  })
})

/*
 * The dialog's machinery arrives on demand (quill-plan.md section 31). Every
 * test above runs with it already here (`vitest.setup.ts`); these load a fresh
 * copy of the dialog whose machinery has not arrived, and decide when it does.
 */
async function freshDialog() {
  vi.resetModules()
  const { promise: arrived, resolve: arrive } = Promise.withResolvers<void>()
  vi.doMock('./dialog-panels.tsx', async () => {
    await arrived
    return vi.importActual('./dialog-panels.tsx')
  })
  const dialog = await import('./dialog.tsx')
  return { ...dialog, arrive }
}

describe('a dialog whose machinery has not arrived yet', () => {
  afterEach(() => {
    vi.doUnmock('./dialog-panels.tsx')
  })

  it('draws its trigger alone, announced as the trigger of a dialog', async () => {
    const { Dialog: FreshDialog } = await freshDialog()
    const { container } = render(
      <FreshDialog title="Delete document" trigger={<Button>Delete</Button>}>
        This cannot be undone.
      </FreshDialog>,
    )

    const trigger = screen.getByRole('button', { name: 'Delete' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('holds a press on its trigger and opens once the machinery arrives', async () => {
    const { Dialog: FreshDialog, arrive } = await freshDialog()
    render(
      <FreshDialog title="Delete document" trigger={<Button>Delete</Button>}>
        This cannot be undone.
      </FreshDialog>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('aria-busy', 'true')

    arrive()
    const dialog = await screen.findByRole('dialog', { name: 'Delete document' })
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
  })

  it('asks its owner to open when it is controlled', async () => {
    const { Dialog: FreshDialog } = await freshDialog()
    const onOpenChange = vi.fn<(open: boolean) => void>()
    render(
      <FreshDialog
        open={false}
        onOpenChange={onOpenChange}
        title="Delete document"
        trigger={<Button>Delete</Button>}
      >
        This cannot be undone.
      </FreshDialog>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('opens when it is opened, as soon as the machinery arrives', async () => {
    const { Dialog: FreshDialog, arrive } = await freshDialog()
    render(
      <FreshDialog open title="Delete document">
        This cannot be undone.
      </FreshDialog>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    arrive()
    expect(await screen.findByRole('dialog', { name: 'Delete document' })).toBeInTheDocument()
  })

  it('draws a close control as its child alone until the machinery arrives', async () => {
    const { DialogClose: FreshDialogClose } = await freshDialog()
    render(
      <FreshDialogClose>
        <Button>Cancel</Button>
      </FreshDialogClose>,
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('keeps its trigger working when fetching the machinery ahead of a press fails', async () => {
    vi.resetModules()
    vi.doMock('./dialog-panels.tsx', () => {
      throw new Error('offline')
    })
    const { Dialog: FreshDialog } = await import('./dialog.tsx')
    render(
      <FreshDialog title="Delete document" trigger={<Button>Delete</Button>}>
        This cannot be undone.
      </FreshDialog>,
    )
    const trigger = screen.getByRole('button', { name: 'Delete' })

    await act(async () => {
      fireEvent.pointerEnter(trigger)
      fireEvent.focus(trigger)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

/*
 * The trigger is never replaced by the machinery (2026-10-17): a press that
 * lands in the same task as the module arriving is on a node that is still
 * the trigger afterwards, so it opens the dialog rather than vanishing.
 */
describe('a press that lands as the machinery arrives', () => {
  afterEach(() => {
    vi.doUnmock('./dialog-panels.tsx')
  })

  it('opens the dialog from the same trigger element', async () => {
    const { Dialog: FreshDialog, preloadDialogs, arrive } = await freshDialog()
    render(
      <FreshDialog title="Delete document" trigger={<Button>Delete</Button>}>
        Body.
      </FreshDialog>,
    )
    const trigger = screen.getByRole('button', { name: 'Delete' })

    await act(async () => {
      const loading = preloadDialogs()
      arrive()
      await loading
      fireEvent.pointerDown(trigger)
      fireEvent.click(trigger)
    })

    expect(await screen.findByRole('dialog', { name: 'Delete document' })).toBeInTheDocument()
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})
