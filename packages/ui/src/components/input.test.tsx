import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Input } from './input.tsx'

describe('Input', () => {
  it('associates its label with the field', async () => {
    const { container } = render(<Input label="Document title" />)

    expect(screen.getByLabelText('Document title')).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('accepts typing through the label', async () => {
    render(<Input label="Document title" />)

    await userEvent.type(screen.getByLabelText('Document title'), 'Runbook')

    expect(screen.getByLabelText('Document title')).toHaveValue('Runbook')
  })

  it('is valid and undescribed when it has neither description nor error', () => {
    render(<Input label="Document title" />)

    const field = screen.getByLabelText('Document title')
    expect(field).toHaveAttribute('aria-invalid', 'false')
    expect(field).not.toHaveAttribute('aria-describedby')
  })

  it('describes the field with its description', async () => {
    const { container } = render(
      <Input label="Slug" description="Lowercase letters, numbers, and hyphens." />,
    )

    expect(screen.getByLabelText('Slug')).toHaveAccessibleDescription(
      'Lowercase letters, numbers, and hyphens.',
    )
    await expectNoAccessibilityViolations(container)
  })

  it('marks the field invalid and describes it with the error', async () => {
    const { container } = render(<Input label="Slug" error="A slug is required." />)

    const field = screen.getByLabelText('Slug')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('A slug is required.')
    await expectNoAccessibilityViolations(container)
  })

  it('announces the error as it appears', () => {
    render(<Input label="Slug" error="A slug is required." />)

    expect(screen.getByRole('alert')).toHaveTextContent('A slug is required.')
  })

  it('describes the field with the description and the error, in reading order', () => {
    render(<Input label="Slug" description="Lowercase only." error="A slug is required." />)

    expect(screen.getByLabelText('Slug')).toHaveAccessibleDescription(
      'Lowercase only. A slug is required.',
    )
  })

  it('marks a required field for sighted and assistive users alike', async () => {
    const { container } = render(<Input label="Slug" required />)

    // The asterisk is aria-hidden, so the accessible name stays clean.
    expect(screen.getByRole('textbox', { name: 'Slug' })).toBeRequired()
    await expectNoAccessibilityViolations(container)
  })

  it('honours a caller-supplied id', () => {
    render(<Input label="Slug" id="document-slug" description="Lowercase only." />)

    const field = screen.getByLabelText('Slug')
    expect(field).toHaveAttribute('id', 'document-slug')
    expect(field).toHaveAttribute('aria-describedby', 'document-slug-description')
  })

  it('gives two fields with the same label distinct ids', () => {
    render(
      <>
        <Input label="Slug" />
        <Input label="Slug" />
      </>,
    )

    const [first, second] = screen.getAllByLabelText('Slug')
    expect(first?.id).not.toBe(second?.id)
  })

  it('passes native attributes through to the field', () => {
    render(<Input label="Slug" placeholder="runbook" disabled />)

    const field = screen.getByLabelText('Slug')
    expect(field).toBeDisabled()
    expect(field).toHaveAttribute('placeholder', 'runbook')
  })

  it('appends caller classes to the wrapper', () => {
    const { container } = render(<Input label="Slug" className="w-64" />)

    expect(container.firstElementChild).toHaveClass('w-64')
  })
})
