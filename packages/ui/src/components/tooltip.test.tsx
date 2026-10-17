import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

/*
 * The tooltip's machinery arrives on demand (quill-plan.md section 31). The
 * tests above run with it already here (`vitest.setup.ts`); this loads a fresh
 * tooltip whose machinery has not arrived, and decides when it does.
 */
describe('a tooltip whose machinery has not arrived yet', () => {
  afterEach(() => {
    vi.doUnmock('./tooltip-panels.tsx')
  })

  it('draws the control alone, and keeps its focus when the tip takes it over', async () => {
    vi.resetModules()
    const { promise: arrived, resolve: arrive } = Promise.withResolvers<void>()
    vi.doMock('./tooltip-panels.tsx', async () => {
      await arrived
      return vi.importActual('./tooltip-panels.tsx')
    })
    const fresh = await import('./tooltip.tsx')
    const { container } = render(
      <fresh.TooltipProvider delayDuration={0}>
        <fresh.Tooltip content="Publishes a new revision">
          <Button>Publish</Button>
        </fresh.Tooltip>
      </fresh.TooltipProvider>,
    )
    await expectNoAccessibilityViolations(container)

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveFocus()

    arrive()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Publishes a new revision')
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveFocus()
  })
})

async function pause(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

describe('a group of tooltips', () => {
  it('waits for a pause before the first tip, and shows the next at once while warm', async () => {
    render(
      <TooltipProvider delayDuration={600}>
        <Tooltip content="Bold">
          <Button>B</Button>
        </Tooltip>
        <Tooltip content="Italic">
          <Button>I</Button>
        </Tooltip>
      </TooltipProvider>,
    )

    await userEvent.hover(screen.getByRole('button', { name: 'B' }))
    await pause(50)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bold')

    await userEvent.unhover(screen.getByRole('button', { name: 'B' }))
    await userEvent.hover(screen.getByRole('button', { name: 'I' }))
    // Well inside the 600 ms a cold group would wait.
    expect(await screen.findByRole('tooltip', {}, { timeout: 300 })).toHaveTextContent('Italic')
  })
})

/*
 * The control is never replaced by the machinery (2026-10-17): the first
 * hover mounts the tip's half beside it, so a click that follows in the same
 * moment — as the module lands — reaches the control it was aimed at.
 */
describe('a click that follows a hover as the machinery arrives', () => {
  afterEach(() => {
    vi.doUnmock('./tooltip-panels.tsx')
  })

  it('activates the control, which is still the same element', async () => {
    vi.resetModules()
    const { promise: arrived, resolve: arrive } = Promise.withResolvers<void>()
    vi.doMock('./tooltip-panels.tsx', async () => {
      await arrived
      return vi.importActual('./tooltip-panels.tsx')
    })
    const fresh = await import('./tooltip.tsx')
    const onClick = vi.fn<() => void>()
    render(
      <fresh.TooltipProvider delayDuration={0}>
        <fresh.Tooltip content="Publishes a new revision">
          <Button onClick={onClick}>Publish</Button>
        </fresh.Tooltip>
      </fresh.TooltipProvider>,
    )
    const control = screen.getByRole('button', { name: 'Publish' })

    await act(async () => {
      fireEvent.pointerEnter(control)
      const loading = fresh.preloadTooltips()
      arrive()
      await loading
      fireEvent.pointerDown(control)
      fireEvent.click(control)
    })

    expect(onClick).toHaveBeenCalledOnce()
    expect(control).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish' })).toBe(control)
  })
})
