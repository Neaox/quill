import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BRAND } from '@quill/brand'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { AuthCard } from './auth-card.tsx'

function renderCard() {
  return render(
    <AuthCard title="Sign in" description="Welcome back." footer={<a href="/sign-up">Sign up</a>}>
      <button type="submit">Continue</button>
    </AuthCard>,
  )
}

/**
 * The frame every signed-out screen shares. The pages' own tests hold their
 * journeys; these hold the frame's shape, which every one of them inherits.
 */
describe('AuthCard', () => {
  it('names the product once, in a banner above the task', async () => {
    const { container } = renderCard()

    const banner = screen.getByRole('banner')
    expect(within(banner).getByText(BRAND.name)).toBeInTheDocument()
    expect(screen.getAllByText(BRAND.name)).toHaveLength(1)
    await expectNoAccessibilityViolations(container)
  })

  it('puts the task, and only the task, in the main landmark', () => {
    renderCard()

    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(within(main).getByText('Welcome back.')).toBeInTheDocument()
    expect(within(main).getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(within(main).getByRole('link', { name: 'Sign up' })).toBeInTheDocument()
    expect(within(main).queryByText(BRAND.tagline)).not.toBeInTheDocument()
  })

  it('says what this instance is beside the task, as a complementary region', () => {
    renderCard()

    const statement = screen.getByRole('complementary', { name: BRAND.tagline })
    expect(within(statement).getByText(BRAND.tagline)).toBeInTheDocument()
    // Only one heading level 1 on the page: the statement is not a second title.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('lets a visitor choose light or dark before they have an account', () => {
    renderCard()

    const theme = screen.getByRole('group', { name: 'Theme' })
    expect(within(theme).getByRole('radio', { name: 'Dark' })).toBeInTheDocument()
  })

  it('leaves the description and footer out when a step has none', () => {
    render(
      <AuthCard title="Signing you in">
        <p>Verifying your link…</p>
      </AuthCard>,
    )

    const main = screen.getByRole('main')
    expect(within(main).queryByRole('link')).not.toBeInTheDocument()
    expect(within(main).getByText('Verifying your link…')).toBeInTheDocument()
  })
})
