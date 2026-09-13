import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Button } from './button.tsx'
import { Tooltip, TooltipProvider } from './tooltip.tsx'

function renderTooltip(side?: 'top' | 'right' | 'bottom' | 'left') {
  return render(
    <TooltipProvider delayDuration={0}>
      <Tooltip content="Publishes a new revision" {...(side === undefined ? {} : { side })}>
        <Button>Publish</Button>
      </Tooltip>
    </TooltipProvider>,
  )
}

describe('Tooltip', () => {
  it('shows nothing until the trigger is used', () => {
    renderTooltip()

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('appears on keyboard focus, so it is not pointer-only', async () => {
    renderTooltip()

    await userEvent.tab()

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Publishes a new revision')
  })

  it('describes the trigger rather than renaming it', async () => {
    renderTooltip()

    await userEvent.tab()
    await screen.findByRole('tooltip')

    const trigger = screen.getByRole('button', { name: 'Publish' })
    expect(trigger).toHaveAccessibleName('Publish')
    expect(trigger).toHaveAccessibleDescription('Publishes a new revision')
  })

  it('appears on hover', async () => {
    renderTooltip()

    await userEvent.hover(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
  })

  it('is dismissed by Escape', async () => {
    renderTooltip()

    await userEvent.tab()
    await screen.findByRole('tooltip')

    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })

  it('accepts a side', async () => {
    renderTooltip('right')

    await userEvent.tab()

    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
  })

  it('has no accessibility violations while open', async () => {
    const { baseElement } = renderTooltip()

    await userEvent.tab()
    await screen.findByRole('tooltip')

    // A portalled fragment is not a page, so the landmark rule is not meaningful here.
    await expectNoAccessibilityViolations(baseElement, { rules: { region: { enabled: false } } })
  })

  it('shares a delay across the provider', async () => {
    render(
      <TooltipProvider>
        <Tooltip content="Hint">
          <Button>Publish</Button>
        </Tooltip>
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })
})
