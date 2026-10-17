import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { AnchoredPopover } from './anchored-popover.tsx'

const ANCHOR = { x: 40, y: 60, width: 120, height: 18 }

function Harness({ onCloseFocus }: { readonly onCloseFocus?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <AnchoredPopover
      open={open}
      anchor={ANCHOR}
      label="Link"
      onOpenChange={setOpen}
      {...(onCloseFocus === undefined ? {} : { onCloseFocus })}
    >
      <label>
        Address
        <input />
      </label>
    </AnchoredPopover>
  )
}

describe('AnchoredPopover', () => {
  it('opens a named panel against its box, and passes axe', async () => {
    render(<Harness />)
    const panel = await screen.findByRole('dialog', { name: 'Link' })
    expect(screen.getByRole('textbox', { name: 'Address' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(panel)
  })

  it('closes on Escape, sending focus where the caller says', async () => {
    const focus = vi.fn<() => void>()
    render(<Harness onCloseFocus={focus} />)
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(focus).toHaveBeenCalled()
  })

  it('lines up with its box’s start by default, or its end when asked', async () => {
    const { unmount } = render(<Harness />)
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-align', 'start')
    unmount()
    render(
      <AnchoredPopover
        open
        anchor={ANCHOR}
        label="Settings"
        align="end"
        onOpenChange={vi.fn<(open: boolean) => void>()}
      >
        Words
      </AnchoredPopover>,
    )
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveAttribute('data-align', 'end')
    })
  })

  it('leaves focus to Radix when the caller has nowhere to send it', async () => {
    render(<Harness />)
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
