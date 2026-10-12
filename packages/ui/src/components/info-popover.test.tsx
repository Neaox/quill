import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { InfoPopover } from './info-popover.tsx'

function renderInfo() {
  return render(
    <InfoPopover
      label="About AA text contrast"
      title="What AA contrast means"
      learnMore={{
        href: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum',
        label: 'Read the W3C guidance',
      }}
    >
      Text needs enough contrast to be read.
    </InfoPopover>,
  )
}

describe('InfoPopover', () => {
  it('is a button named for what it explains, closed until asked', () => {
    renderInfo()
    const trigger = screen.getByRole('button', { name: 'About AA text contrast' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Text needs enough contrast to be read.')).not.toBeInTheDocument()
  })

  it('opens on a click or a tap, titled, with its explanation and a link out', async () => {
    const user = userEvent.setup()
    renderInfo()
    await user.click(screen.getByRole('button', { name: 'About AA text contrast' }))

    const panel = screen.getByRole('dialog', { name: 'What AA contrast means' })
    expect(panel).toHaveTextContent('Text needs enough contrast to be read.')
    const link = screen.getByRole('link', { name: /Read the W3C guidance/u })
    expect(link).toHaveAttribute(
      'href',
      'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum',
    )
    // An external link: a new tab, with no handle on this one (ADR-011).
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('closes on Escape and gives focus back to its button', async () => {
    const user = userEvent.setup()
    renderInfo()
    const trigger = screen.getByRole('button', { name: 'About AA text contrast' })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('needs no link to be useful', async () => {
    const user = userEvent.setup()
    render(
      <InfoPopover label="About density" title="Density">
        Compact is one step tighter.
      </InfoPopover>,
    )
    await user.click(screen.getByRole('button', { name: 'About density' }))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('has no accessibility violations, closed or open', async () => {
    const user = userEvent.setup()
    const { container } = renderInfo()
    await expectNoAccessibilityViolations(container)
    await user.click(screen.getByRole('button', { name: 'About AA text contrast' }))
    await expectNoAccessibilityViolations(document.body)
  })
})
