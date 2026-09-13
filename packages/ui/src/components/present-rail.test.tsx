import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { PresentRail } from './present-rail.tsx'

const SECTIONS = [
  { id: 'overview', title: 'Overview' },
  { id: 'endpoints', title: 'Endpoints' },
  { id: 'rollout', title: 'Rollout' },
]

describe('PresentRail', () => {
  it('names every mark for the section it goes to, and marks the current one', async () => {
    const { container } = render(
      <PresentRail items={SECTIONS} currentIndex={1} onSelect={() => {}} />,
    )

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    const steps = within(rail).getAllByRole('button')

    expect(steps.map((step) => step.getAttribute('aria-label'))).toEqual([
      'Section 1: Overview',
      'Section 2: Endpoints',
      'Section 3: Rollout',
    ])
    expect(steps[1]).toHaveAttribute('aria-current', 'true')
    expect(steps[0]).not.toHaveAttribute('aria-current')
    await expectNoAccessibilityViolations(container)
  })

  it('jumps to the section a mark stands for', async () => {
    const onSelect = vi.fn<(index: number) => void>()
    render(<PresentRail items={SECTIONS} currentIndex={0} onSelect={onSelect} />)

    await userEvent.click(screen.getByRole('button', { name: 'Section 3: Rollout' }))

    expect(onSelect).toHaveBeenCalledWith(2)
  })
})
