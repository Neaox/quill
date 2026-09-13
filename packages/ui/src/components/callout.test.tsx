import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Callout } from './callout.tsx'

describe('Callout', () => {
  it('defaults to the info tone and names itself with the tone word', async () => {
    const { container } = render(<Callout>Drafts are private until you publish.</Callout>)

    expect(screen.getByRole('group', { name: 'Note' })).toHaveTextContent(
      'Drafts are private until you publish.',
    )
    await expectNoAccessibilityViolations(container)
  })

  it.each([
    ['info', 'Note'],
    ['success', 'Success'],
    ['warning', 'Warning'],
    ['danger', 'Danger'],
  ] as const)('conveys the %s tone in words as well as colour', async (tone, label) => {
    const { container } = render(<Callout tone={tone}>Body text.</Callout>)

    expect(screen.getByRole('group', { name: label })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('uses the title as its accessible name and keeps the tone word for screen readers', async () => {
    const { container } = render(
      <Callout tone="warning" title="Publishing is irreversible">
        Every publish creates a revision.
      </Callout>,
    )

    const callout = screen.getByRole('group', { name: 'Warning: Publishing is irreversible' })
    expect(callout).toHaveTextContent('Publishing is irreversible')
    expect(callout).toHaveTextContent('Every publish creates a revision.')
    await expectNoAccessibilityViolations(container)
  })

  it('gives every tone a different container class', () => {
    const classes = new Set<string>()
    for (const tone of ['info', 'success', 'warning', 'danger'] as const) {
      const { unmount } = render(<Callout tone={tone}>Body.</Callout>)
      classes.add(screen.getByRole('group').className)
      unmount()
    }

    expect(classes.size).toBe(4)
  })

  it('appends caller classes', () => {
    render(<Callout className="mt-8">Body.</Callout>)

    expect(screen.getByRole('group')).toHaveClass('mt-8')
  })

  it('shows the tone word as the visible heading when there is no title', () => {
    render(<Callout tone="danger">Body.</Callout>)

    expect(screen.getByRole('group', { name: 'Danger' })).toHaveTextContent('Danger')
  })

  it('does not announce the visible heading twice', () => {
    render(
      <Callout tone="danger" title="Locked by another author">
        Body.
      </Callout>,
    )

    const heading = screen.getByText('Locked by another author')
    expect(heading).toHaveAttribute('aria-hidden', 'true')
  })
})
