import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import type { ThemePreference } from '@quill/ui'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { nextColourScheme } from './colour-schemes.ts'
import { ThemeToggle } from './theme-toggle.tsx'

function Harness({ initial = 'system' }: { readonly initial?: ThemePreference }) {
  const [preference, setPreference] = useState<ThemePreference>(initial)
  return <ThemeToggle preference={preference} onPreferenceChange={setPreference} />
}

const button = () => screen.getByRole('button', { name: /^Colour scheme:/u })

describe('the colour scheme toggle', () => {
  it('is one button, named by the scheme it is on and saying what pressing it does', () => {
    render(<Harness />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(button()).toHaveAccessibleName('Colour scheme: System')
    expect(button()).toHaveAccessibleDescription('Switch to Light')
  })

  it('cycles System, Light, Dark and back to System, one press at a time', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(button())
    expect(button()).toHaveAccessibleName('Colour scheme: Light')
    await user.click(button())
    expect(button()).toHaveAccessibleName('Colour scheme: Dark')
    await user.click(button())
    expect(button()).toHaveAccessibleName('Colour scheme: System')
  })

  it('is pressed from the keyboard like any button', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    button().focus()
    await user.keyboard('{Enter}')
    expect(button()).toHaveAccessibleName('Colour scheme: Light')
    await user.keyboard(' ')
    expect(button()).toHaveAccessibleName('Colour scheme: Dark')
  })

  it('draws the icon of the scheme it is on: a device for System, a sun, a moon', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(button().querySelector('svg')).toHaveAttribute('data-scheme', 'system')
    await user.click(button())
    expect(button().querySelector('svg')).toHaveAttribute('data-scheme', 'light')
    await user.click(button())
    expect(button().querySelector('svg')).toHaveAttribute('data-scheme', 'dark')
  })

  it('says nothing until it is used, then says the new scheme politely, because the button keeps the focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    await user.click(button())

    expect(screen.getByRole('status')).toHaveTextContent('Colour scheme: Light')
  })

  it('has nothing for an axe check to object to, in any scheme', async () => {
    for (const initial of ['system', 'light', 'dark'] as const) {
      const { container, unmount } = render(<Harness initial={initial} />)
      await expectNoAccessibilityViolations(container)
      unmount()
    }
  })
})

describe('the next scheme', () => {
  it('follows the order every control offers them in, and wraps', () => {
    expect(nextColourScheme('system')).toBe('light')
    expect(nextColourScheme('light')).toBe('dark')
    expect(nextColourScheme('dark')).toBe('system')
  })
})
