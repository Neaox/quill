import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Textarea } from './textarea.tsx'

describe('Textarea', () => {
  it('associates its label with the field and accepts typing', async () => {
    const { container } = render(<Textarea label="Message" />)

    await userEvent.type(screen.getByLabelText('Message'), 'Please look at section two')

    expect(screen.getByLabelText('Message')).toHaveValue('Please look at section two')
    await expectNoAccessibilityViolations(container)
  })

  it('describes the field with its description and marks it invalid with its error', () => {
    render(<Textarea label="Message" description="Optional." error="Too long." />)

    const field = screen.getByLabelText('Message')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Optional. Too long.')
    expect(screen.getByRole('alert')).toHaveTextContent('Too long.')
  })

  it('says how much is left when it has a limit', async () => {
    render(<Textarea label="Message" maxLength={20} defaultValue="Hello" />)

    expect(screen.getByText('15 left')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Message'), '!!')
    expect(screen.getByText('13 left')).toBeInTheDocument()
  })

  it('counts what a controlled field holds, and tells the owner of each change', async () => {
    const changes: string[] = []
    render(
      <Textarea
        label="Message"
        maxLength={20}
        value="Hello"
        onChange={(event) => changes.push(event.target.value)}
      />,
    )

    expect(screen.getByText('15 left')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Message'), '!')
    expect(changes).toEqual(['Hello!'])
    expect(screen.getByText('15 left')).toBeInTheDocument()
  })

  it('marks a required field for sight and for the browser, not for the label read aloud', () => {
    render(<Textarea label="Message" required />)

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeRequired()
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true')
  })
})
