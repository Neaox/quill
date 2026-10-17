import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { ChoiceMenu } from './choice-menu.tsx'
import { PropertyPopover } from './property-popover.tsx'

function Harness() {
  return (
    <PropertyPopover label="Edit type" trigger={<button type="button">Runbook</button>}>
      {(close) => (
        <>
          <label>
            Type
            <input defaultValue="Runbook" />
          </label>
          <button type="button" onClick={close}>
            Done
          </button>
        </>
      )}
    </PropertyPopover>
  )
}

describe('PropertyPopover', () => {
  it('opens a named panel from the value it edits, and passes axe', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Runbook' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    await user.click(trigger)
    const panel = await screen.findByRole('dialog', { name: 'Edit type' })
    expect(screen.getByRole('textbox', { name: 'Type' })).toHaveFocus()
    await expectNoAccessibilityViolations(panel)
  })

  it('closes on Escape and gives focus back to the value', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Runbook' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Runbook' })).toHaveFocus()
  })

  it('can be closed from inside, by whatever finishes the edit', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Runbook' }))
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports opening and closing to a caller that controls it', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn<(open: boolean) => void>()
    function Controlled() {
      const [open, setOpen] = useState(true)
      return (
        <PropertyPopover
          label="Edit tags"
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next)
            setOpen(next)
          }}
          trigger={<button type="button">Tags</button>}
        >
          <p>Inside</p>
        </PropertyPopover>
      )
    }
    render(<Controlled />)
    expect(await screen.findByRole('dialog', { name: 'Edit tags' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('ChoiceMenu', () => {
  const OPTIONS = [
    { value: 'draft', label: 'Draft', leading: <span data-testid="dot" /> },
    { value: 'published', label: 'Published' },
    { value: '', label: 'Not set' },
  ]

  it('lists every choice as a radio item with the chosen one checked, and passes axe', async () => {
    const user = userEvent.setup()
    render(
      <ChoiceMenu
        label="Status"
        value="draft"
        options={OPTIONS}
        onValueChange={() => {}}
        trigger={<button type="button">Draft</button>}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Draft' }))
    const menu = await screen.findByRole('menu', { name: 'Draft' })
    expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Draft' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemradio', { name: 'Published' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await expectNoAccessibilityViolations(menu)
  })

  it('can be opened by its caller', async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>()
    render(
      <ChoiceMenu
        label="Status"
        value=""
        options={OPTIONS}
        open
        onOpenChange={onOpenChange}
        onValueChange={() => {}}
        trigger={<button type="button">Status</button>}
      />,
    )
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('chooses with the keyboard, closes, and gives focus back', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn<(value: string) => void>()
    render(
      <ChoiceMenu
        label="Status"
        value="draft"
        options={OPTIONS}
        onValueChange={onValueChange}
        trigger={<button type="button">Draft</button>}
      />,
    )
    screen.getByRole('button', { name: 'Draft' }).focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('menu')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onValueChange).toHaveBeenCalledWith('published')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'Draft' })).toHaveFocus()
  })
})
