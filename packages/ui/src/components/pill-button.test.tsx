import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FormEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { PillButton } from './pill-button.tsx'

describe('PillButton', () => {
  it('shows its label and its detail, and is named by whatever the caller says', async () => {
    const { container } = render(
      <PillButton detail="12" aria-label="api, 12 results">
        api
      </PillButton>,
    )

    const button = screen.getByRole('button', { name: 'api, 12 results' })
    expect(button).toHaveTextContent('api')
    expect(button).toHaveTextContent('12')
    await expectNoAccessibilityViolations(container)
  })

  it('is named by its text when no name is given, and needs no detail', () => {
    render(<PillButton>api</PillButton>)

    expect(screen.getByRole('button', { name: 'api' })).toBeInTheDocument()
  })

  it('acts on a click and from the keyboard', async () => {
    const onClick = vi.fn<() => void>()
    render(<PillButton onClick={onClick}>api</PillButton>)

    const button = screen.getByRole('button', { name: 'api' })
    await userEvent.click(button)
    button.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')

    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it('does not submit a form it sits in', async () => {
    const onSubmit = vi.fn<(event: FormEvent) => void>((event) => {
      event.preventDefault()
    })
    render(
      <form onSubmit={onSubmit}>
        <PillButton>api</PillButton>
      </form>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'api' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('can be disabled with the real attribute', () => {
    render(<PillButton disabled>api</PillButton>)

    expect(screen.getByRole('button', { name: 'api' })).toBeDisabled()
  })

  it('takes a class from the caller', () => {
    render(<PillButton className="extra">api</PillButton>)

    expect(screen.getByRole('button', { name: 'api' })).toHaveClass('extra')
  })
})
