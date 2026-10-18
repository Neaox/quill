import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FormEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { FilterChip } from './filter-chip.tsx'

describe('FilterChip', () => {
  it('says what it filters on, and offers to take it away under a name that says which', async () => {
    const { container } = render(
      <FilterChip removeLabel="Remove filter By: ada" onRemove={vi.fn<() => void>()}>
        By: ada
      </FilterChip>,
    )

    expect(screen.getByText('By: ada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter By: ada' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('removes on a click, and from the keyboard', async () => {
    const onRemove = vi.fn<() => void>()
    render(
      <FilterChip removeLabel="Remove filter Tag: x" onRemove={onRemove}>
        Tag: x
      </FilterChip>,
    )

    const remove = screen.getByRole('button', { name: 'Remove filter Tag: x' })
    await userEvent.click(remove)
    remove.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')

    expect(onRemove).toHaveBeenCalledTimes(3)
  })

  it('does not submit a form it sits in: removing a filter is not searching', async () => {
    const onSubmit = vi.fn<(event: FormEvent) => void>((event) => {
      event.preventDefault()
    })
    render(
      <form onSubmit={onSubmit}>
        <FilterChip removeLabel="Remove filter Tag: x" onRemove={vi.fn<() => void>()}>
          Tag: x
        </FilterChip>
      </form>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Tag: x' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('marks a filter that is left out as an attribute, the text carrying the meaning', () => {
    const { rerender } = render(
      <FilterChip removeLabel="Remove" onRemove={vi.fn<() => void>()}>
        By: ada
      </FilterChip>,
    )
    expect(screen.getByText('By: ada').closest('[data-negated]')).toHaveAttribute(
      'data-negated',
      'false',
    )

    rerender(
      <FilterChip negated removeLabel="Remove" onRemove={vi.fn<() => void>()}>
        Not by: ada
      </FilterChip>,
    )
    expect(screen.getByText('Not by: ada').closest('[data-negated]')).toHaveAttribute(
      'data-negated',
      'true',
    )
  })

  it('appends caller classes', () => {
    render(
      <FilterChip className="mt-2" removeLabel="Remove" onRemove={vi.fn<() => void>()}>
        By: ada
      </FilterChip>,
    )
    expect(screen.getByText('By: ada').closest('[data-negated]')).toHaveClass('mt-2')
  })
})
