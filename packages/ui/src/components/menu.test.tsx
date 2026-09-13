import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Menu } from './menu.tsx'

const ITEMS = [
  { label: 'Rename…', onSelect: () => {} },
  { label: 'Move to…', onSelect: () => {} },
  { label: 'Delete…', onSelect: () => {} },
]

describe('Menu', () => {
  it('names the thing its actions act on, so three identical triggers are told apart', async () => {
    const { container } = render(<Menu label="Failover" items={ITEMS} />)

    const trigger = screen.getByRole('button', { name: 'More actions for Failover' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expectNoAccessibilityViolations(container)
  })

  it('renders nothing at all when it has no actions to offer', () => {
    render(<Menu label="Failover" items={[]} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('opens on click and lists every action as a menu item', async () => {
    render(<Menu label="Failover" items={ITEMS} />)

    const trigger = screen.getByRole('button', { name: 'More actions for Failover' })
    await userEvent.click(trigger)

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('leaves the page behind it usable, because a row menu is not a dialog', async () => {
    render(
      <>
        <button type="button">Something else</button>
        <Menu label="Failover" items={ITEMS} />
      </>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Failover' }))
    await screen.findByRole('menu')

    expect(screen.getByRole('button', { name: 'Something else' })).toBeInTheDocument()
    expect(document.body).not.toHaveAttribute('data-scroll-locked')
  })

  /*
   * The keyboard model both hand-rolled menus claimed with `role="menu"` and
   * never implemented (review 2026-09-13, M6): opening from the keyboard
   * focuses the first item, and the arrow keys move between them.
   */
  it('opens from the keyboard onto the first item, and moves with the arrow keys', async () => {
    render(<Menu label="Failover" items={ITEMS} />)

    screen.getByRole('button', { name: 'More actions for Failover' }).focus()
    await userEvent.keyboard('{Enter}')

    await screen.findByRole('menu')
    expect(screen.getByRole('menuitem', { name: 'Rename…' })).toHaveFocus()

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Move to…' })).toHaveFocus()

    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Rename…' })).toHaveFocus()
  })

  it('closes on Escape and gives focus back to the trigger', async () => {
    render(<Menu label="Failover" items={ITEMS} />)

    const trigger = screen.getByRole('button', { name: 'More actions for Failover' })
    await userEvent.click(trigger)
    await screen.findByRole('menu')

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('runs the action that was chosen, and closes', async () => {
    const onSelect = vi.fn<() => void>()
    render(<Menu label="Failover" items={[{ label: 'Delete…', onSelect }]} />)

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Failover' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('takes its own alignment and classes for a row that needs a different trigger', async () => {
    render(
      <Menu
        label="Guides"
        items={ITEMS}
        align="start"
        triggerClassName="size-5"
        className="min-w-56"
      />,
    )

    const trigger = screen.getByRole('button', { name: 'More actions for Guides' })
    expect(trigger).toHaveClass('size-5')

    await userEvent.click(trigger)
    expect(await screen.findByRole('menu')).toHaveClass('min-w-56')
  })

  it('marks a disabled action disabled rather than leaving it to swallow a press', async () => {
    const onSelect = vi.fn<() => void>()
    render(
      <Menu label="Failover" items={[{ label: 'Delete…', onSelect, disabled: true }]} />, //
    )

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Failover' }))
    const item = await screen.findByRole('menuitem', { name: 'Delete…' })

    expect(item).toHaveAttribute('data-disabled')
    await userEvent.click(item)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
