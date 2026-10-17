import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Textarea } from './textarea.tsx'

describe('Textarea', () => {
  it('associates its label with the field and accepts typing, line breaks included', async () => {
    const { container } = render(<Textarea label="Blocked sites" />)

    const field = screen.getByLabelText('Blocked sites')
    await userEvent.type(field, 'a.example{enter}b.example')

    expect(field).toHaveValue('a.example\nb.example')
    await expectNoAccessibilityViolations(container)
  })

  it('is valid and undescribed when it has neither description nor error', () => {
    render(<Textarea label="Blocked sites" />)

    const field = screen.getByLabelText('Blocked sites')
    expect(field).toHaveAttribute('aria-invalid', 'false')
    expect(field).not.toHaveAttribute('aria-describedby')
  })

  it('describes the field with its description, then its error, and marks it invalid', async () => {
    const { container } = render(
      <Textarea
        label="Blocked sites"
        description="One pattern per line."
        error={<ul><li>Line 2 is not a host.</li></ul>}
      />,
    )

    const field = screen.getByLabelText('Blocked sites')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('One pattern per line. Line 2 is not a host.')
    expect(screen.getByRole('alert')).toHaveTextContent('Line 2 is not a host.')
    await expectNoAccessibilityViolations(container)
  })

  it('can be disabled', () => {
    render(<Textarea label="Blocked sites" disabled />)
    expect(screen.getByLabelText('Blocked sites')).toBeDisabled()
  })
})
