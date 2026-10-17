import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { InfoPopover } from '@quill/ui'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'
import { ToggleField } from './toggle-field.tsx'

function Harness({ disabled = false }: { readonly disabled?: boolean }) {
  const [on, setOn] = useState(false)
  return (
    <ToggleField
      label="Allow share links"
      description="Anybody with the link can read the document."
      checked={on}
      disabled={disabled}
      onCheckedChange={setOn}
    />
  )
}

describe('ToggleField', () => {
  it('is a switch, named by its label and described by its sentence', () => {
    render(<Harness />)
    const toggle = screen.getByRole('switch', { name: 'Allow share links' })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription('Anybody with the link can read the document.')
  })

  it('turns on and off from a click on it or on its label, and from the keyboard', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const toggle = screen.getByRole('switch', { name: 'Allow share links' })

    await user.click(toggle)
    expect(toggle).toBeChecked()
    await user.click(screen.getByText('Allow share links'))
    expect(toggle).not.toBeChecked()
    toggle.focus()
    await user.keyboard(' ')
    expect(toggle).toBeChecked()
  })

  it('cannot be changed when disabled', async () => {
    const user = userEvent.setup()
    render(<Harness disabled />)
    const toggle = screen.getByRole('switch', { name: 'Allow share links' })
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(toggle).toBeDisabled()
  })

  it('carries an explanation beside its label without changing the switch’s name', async () => {
    const user = userEvent.setup()
    render(
      <ToggleField
        label="Enforce AA text contrast"
        help={
          <InfoPopover label="About AA text contrast" title="What AA contrast means">
            Enough contrast to read.
          </InfoPopover>
        }
        checked
        onCheckedChange={() => undefined}
      />,
    )

    expect(screen.getByRole('switch', { name: 'Enforce AA text contrast' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'About AA text contrast' }))
    expect(screen.getByRole('dialog', { name: 'What AA contrast means' })).toBeVisible()
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness />)
    await expectNoAccessibilityViolations(container)
  })
})
