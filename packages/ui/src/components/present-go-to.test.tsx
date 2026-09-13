import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { matchingSections, PresentGoTo } from './present-go-to.tsx'

const SECTIONS = [
  { id: 'title', title: 'Authentication architecture' },
  { id: 'overview', title: 'Overview' },
  { id: 'endpoints', title: 'Endpoints' },
  { id: 'rollout', title: 'Rollout and rollback' },
]

function overlay(overrides: Partial<Parameters<typeof PresentGoTo>[0]> = {}) {
  return (
    <PresentGoTo
      open
      sections={SECTIONS}
      currentIndex={1}
      onSelect={() => {}}
      onClose={() => {}}
      {...overrides}
    />
  )
}

describe('matchingSections', () => {
  it('keeps every section, in order, for an empty query', () => {
    expect(matchingSections(SECTIONS, '   ').map((section) => section.index)).toEqual([0, 1, 2, 3])
  })

  it('matches any part of a title, ignoring case', () => {
    expect(matchingSections(SECTIONS, 'ROLL').map((section) => section.title)).toEqual([
      'Rollout and rollback',
    ])
    expect(matchingSections(SECTIONS, 'o').map((section) => section.id)).toEqual([
      'title',
      'overview',
      'endpoints',
      'rollout',
    ])
  })

  it('matches a section by its number in the presentation', () => {
    expect(matchingSections(SECTIONS, '3').map((section) => section.id)).toEqual(['endpoints'])
  })

  it('reports no match rather than falling back to everything', () => {
    expect(matchingSections(SECTIONS, 'zzz')).toEqual([])
  })

  it('carries the position in the presentation, not the position in the filtered list', () => {
    expect(matchingSections(SECTIONS, 'Rollout')).toEqual([
      { id: 'rollout', title: 'Rollout and rollback', index: 3 },
    ])
  })
})

describe('PresentGoTo', () => {
  it('renders nothing until it is opened', () => {
    render(overlay({ open: false }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens as a named dialog with the filter focused and every section listed', async () => {
    const { container } = render(overlay())

    const dialog = screen.getByRole('dialog', { name: 'Go to a section' })
    expect(within(dialog).getByRole('combobox', { name: 'Filter sections' })).toHaveFocus()
    expect(within(dialog).getAllByRole('option')).toHaveLength(4)
    await expectNoAccessibilityViolations(container)
  })

  it('filters as the presenter types, and says so when nothing matches', async () => {
    render(overlay())

    await userEvent.keyboard('endpo')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '3Endpoints',
    ])

    await userEvent.keyboard('{Backspace>5/}zzz')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText(/No section matches/)).toBeVisible()
  })

  it('moves the active option with the arrows without moving focus off the filter', async () => {
    render(overlay())
    const filter = screen.getByRole('combobox', { name: 'Filter sections' })

    await userEvent.keyboard('{ArrowDown}{ArrowDown}')

    const options = screen.getAllByRole('option')
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    expect(filter).toHaveAttribute('aria-activedescendant', options[2]?.id)
    expect(filter).toHaveFocus()
  })

  it('stops at the ends rather than wrapping', async () => {
    render(overlay())

    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{End}')
    expect(screen.getAllByRole('option')[3]).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[3]).toHaveAttribute('aria-selected', 'true')
  })

  it('jumps back to the first match on Home', async () => {
    render(overlay())

    await userEvent.keyboard('{End}')
    expect(screen.getAllByRole('option')[3]).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{Home}')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('moves nothing when an arrow or Enter is pressed with no match to land on', async () => {
    const onSelect = vi.fn<(index: number) => void>()
    render(overlay({ onSelect }))

    await userEvent.keyboard('zzz')
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('goes to the section Enter lands on, by its position in the presentation', async () => {
    const onSelect = vi.fn<(index: number) => void>()
    render(overlay({ onSelect }))

    await userEvent.keyboard('rollout{Enter}')

    expect(onSelect).toHaveBeenCalledWith(3)
  })

  it('goes to a section a pointer chooses', async () => {
    const onSelect = vi.fn<(index: number) => void>()
    render(overlay({ onSelect }))

    await userEvent.click(screen.getByRole('option', { name: /Endpoints/ }))

    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('closes on Escape and on the Close button, and never lets a key past it', async () => {
    const onClose = vi.fn<() => void>()
    const onSurfaceKey = vi.fn<(event: KeyboardEvent) => void>()
    // The surface's own key map listens on the window, above the overlay;
    // nothing the overlay understands may reach it.
    window.addEventListener('keydown', onSurfaceKey)
    render(overlay({ onClose }))

    await userEvent.keyboard('{Escape}')
    window.removeEventListener('keydown', onSurfaceKey)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSurfaceKey).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps Tab inside the panel', async () => {
    render(overlay())

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

    await userEvent.tab()
    expect(screen.getByRole('combobox', { name: 'Filter sections' })).toHaveFocus()
  })

  it('keeps Shift+Tab inside the panel too, moving the other way', async () => {
    render(overlay())
    expect(screen.getByRole('combobox', { name: 'Filter sections' })).toHaveFocus()

    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('marks the section being presented, whatever the filter shows', () => {
    render(overlay({ currentIndex: 2 }))

    const options = screen.getAllByRole('option')
    expect(options[2]).toHaveAttribute('aria-current', 'true')
    expect(options[1]).not.toHaveAttribute('aria-current')
  })
})
