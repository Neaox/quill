import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Popover } from './popover.tsx'

describe('Popover', () => {
  it('opens a labelled panel from its button and closes it with Escape, returning focus', async () => {
    render(
      <Popover label="Notifications" title="Notifications" trigger={<span>Bell</span>}>
        <p>Nothing new.</p>
      </Popover>,
    )

    const button = screen.getByRole('button', { name: 'Notifications' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(button)

    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(panel).toHaveTextContent('Nothing new.')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await expectNoAccessibilityViolations(panel)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('says when it is open, for a caller that keeps something in step with it', async () => {
    const seen: boolean[] = []
    render(
      <Popover
        label="Notifications"
        title="Notifications"
        trigger={<span>Bell</span>}
        onOpenChange={(open) => seen.push(open)}
      >
        <p>Body</p>
      </Popover>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    await userEvent.keyboard('{Escape}')

    expect(seen).toEqual([true, false])
  })
})
