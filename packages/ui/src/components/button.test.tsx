import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Button, buttonClassName } from './button.tsx'

describe('Button', () => {
  it('renders an accessible button carrying its label', async () => {
    const { container } = render(<Button>Publish</Button>)

    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('defaults to type="button" so it cannot submit a surrounding form by accident', () => {
    render(<Button>Cancel</Button>)

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button')
  })

  it('accepts an explicit type', () => {
    render(<Button type="submit">Save</Button>)

    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit')
  })

  it('calls its handler when clicked', async () => {
    const onClick = vi.fn<() => void>()
    render(<Button onClick={onClick}>Publish</Button>)

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is operable from the keyboard', async () => {
    const onClick = vi.fn<() => void>()
    render(<Button onClick={onClick}>Publish</Button>)

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()
  })

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'renders the %s variant with a distinct class list',
    (variant) => {
      render(<Button variant={variant}>Action</Button>)

      expect(screen.getByRole('button', { name: 'Action' }).className).toContain('rounded-md')
    },
  )

  it.each(['sm', 'md', 'lg'] as const)('renders the %s size', (size) => {
    render(<Button size={size}>Action</Button>)

    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
  })

  it('gives every variant and size a different class list', () => {
    const classes = new Set<string>()
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      for (const size of ['sm', 'md', 'lg'] as const) {
        const { unmount } = render(
          <Button variant={variant} size={size}>
            Action
          </Button>,
        )
        classes.add(screen.getByRole('button', { name: 'Action' }).className)
        unmount()
      }
    }

    expect(classes.size).toBe(12)
  })

  it('appends caller classes after its own', () => {
    render(<Button className="w-full">Action</Button>)

    expect(screen.getByRole('button', { name: 'Action' }).className).toMatch(/w-full$/)
  })

  it('is not busy by default', () => {
    render(<Button>Action</Button>)

    expect(screen.getByRole('button', { name: 'Action' })).toHaveAttribute('aria-busy', 'false')
  })

  it('announces the loading state and refuses interaction while loading', async () => {
    const onClick = vi.fn<() => void>()
    render(
      <Button loading onClick={onClick}>
        Publishing
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Publishing' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()

    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps its label visible while loading', () => {
    render(<Button loading>Publishing</Button>)

    expect(screen.getByRole('button', { name: 'Publishing' })).toHaveTextContent('Publishing')
  })

  it('refuses interaction when disabled', async () => {
    const onClick = vi.fn<() => void>()
    render(
      <Button disabled onClick={onClick}>
        Action
      </Button>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Action' }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders leading and trailing icon slots, hidden from assistive technology', async () => {
    const { container } = render(
      <Button
        iconStart={<svg data-testid="icon-start" aria-hidden="true" />}
        iconEnd={<svg data-testid="icon-end" aria-hidden="true" />}
      >
        Action
      </Button>,
    )

    expect(screen.getByTestId('icon-start')).toBeInTheDocument()
    expect(screen.getByTestId('icon-end')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('replaces the leading icon with the spinner while loading', () => {
    render(
      <Button loading iconStart={<svg data-testid="icon-start" aria-hidden="true" />}>
        Action
      </Button>,
    )

    expect(screen.queryByTestId('icon-start')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Action' }).querySelector('svg')).toBeInTheDocument()
  })
})

describe('buttonClassName', () => {
  it('matches the rendered button for the same options', () => {
    render(
      <Button variant="ghost" size="lg" className="w-full">
        Action
      </Button>,
    )

    expect(screen.getByRole('button', { name: 'Action' }).className).toBe(
      buttonClassName({ variant: 'ghost', size: 'lg', className: 'w-full' }),
    )
  })

  it('defaults to the primary variant at the medium size', () => {
    render(<Button>Action</Button>)

    expect(screen.getByRole('button', { name: 'Action' }).className).toBe(buttonClassName())
  })
})
