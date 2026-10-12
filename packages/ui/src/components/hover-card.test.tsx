import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { HoverCard } from './hover-card.tsx'

function renderCard() {
  return render(
    <HoverCard title="Changes to publish" content={<p>Two sections changed.</p>}>
      <button type="button">Publish</button>
    </HoverCard>,
  )
}

describe('HoverCard', () => {
  it('is its trigger alone until it is asked for', () => {
    renderCard()

    expect(screen.getByRole('button', { name: 'Publish' })).toBeVisible()
    expect(screen.queryByText('Two sections changed.')).not.toBeInTheDocument()
  })

  it('opens when the pointer rests on the trigger, titled, with what it holds', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.hover(screen.getByRole('button', { name: 'Publish' }))

    const panel = await screen.findByText('Two sections changed.')
    expect(panel).toBeVisible()
    expect(screen.getByText('Changes to publish')).toBeVisible()
  })

  it('opens for the keyboard, which has no pointer to rest', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.tab()

    expect(await screen.findByText('Two sections changed.')).toBeVisible()
  })

  it('goes when the pointer does, and on Escape', async () => {
    const user = userEvent.setup()
    renderCard()
    const trigger = screen.getByRole('button', { name: 'Publish' })

    await user.hover(trigger)
    await screen.findByText('Two sections changed.')
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByText('Two sections changed.')).not.toBeInTheDocument()
    })
  })

  it('keeps its trigger the button it was, and puts nothing between it and a screen reader', async () => {
    const user = userEvent.setup()
    const { container } = renderCard()
    await user.hover(screen.getByRole('button', { name: 'Publish' }))
    await screen.findByText('Two sections changed.')

    await expectNoAccessibilityViolations(container)
  })
})
