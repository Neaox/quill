import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

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
})
