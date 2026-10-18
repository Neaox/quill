import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  it('closes on a second press of its button', async () => {
    render(
      <Popover label="Notifications" title="Notifications" trigger={<span>Bell</span>}>
        <p>Nothing new.</p>
      </Popover>,
    )

    const button = screen.getByRole('button', { name: 'Notifications' })
    await userEvent.click(button)
    await screen.findByRole('dialog', { name: 'Notifications' })

    await userEvent.click(button)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('stays open for a press inside its panel, which bubbles to the button through React', async () => {
    const pressed = vi.fn<() => void>()
    render(
      <Popover label="Notifications" title="Notifications" trigger={<span>Bell</span>}>
        <button type="button" onClick={pressed}>
          Mark all read
        </button>
      </Popover>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }))

    expect(pressed).toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('closes on a press elsewhere and leaves focus where that press put it', async () => {
    render(
      <>
        <Popover label="Notifications" title="Notifications" trigger={<span>Bell</span>}>
          <p>Nothing new.</p>
        </Popover>
        <button type="button">Elsewhere</button>
      </>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    await screen.findByRole('dialog', { name: 'Notifications' })

    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Notifications' })).not.toHaveFocus()
  })
})

/*
 * The panel's machinery arrives on demand. Every test above runs with it
 * already here (`vitest.setup.ts`); these load a fresh copy of the popover
 * whose machinery has not arrived, or cannot.
 */
describe('a popover whose machinery has not arrived yet', () => {
  afterEach(() => {
    vi.doUnmock('./popover-panels.tsx')
  })

  it('holds a press, says it is busy meanwhile, then opens', async () => {
    vi.resetModules()
    const { promise: arrived, resolve: arrive } = Promise.withResolvers<void>()
    vi.doMock('./popover-panels.tsx', async () => {
      await arrived
      return vi.importActual('./popover-panels.tsx')
    })
    const { Popover: FreshPopover } = await import('./popover.tsx')
    render(
      <FreshPopover label="Notifications" title="Notifications" trigger={<span>Bell</span>}>
        <p>Nothing new.</p>
      </FreshPopover>,
    )

    const button = screen.getByRole('button', { name: 'Notifications' })
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    arrive()
    expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()
    expect(button).not.toHaveAttribute('aria-busy')
  })

  it('keeps its button working when fetching the machinery ahead of a press fails', async () => {
    vi.resetModules()
    vi.doMock('./popover-panels.tsx', () => {
      throw new Error('offline')
    })
    const { Popover: FreshPopover } = await import('./popover.tsx')
    render(
      <FreshPopover label="Notifications" title="Notifications" trigger={<span>Bell</span>}>
        <p>Nothing new.</p>
      </FreshPopover>,
    )
    const button = screen.getByRole('button', { name: 'Notifications' })

    await act(async () => {
      fireEvent.pointerEnter(button)
      fireEvent.focus(button)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
