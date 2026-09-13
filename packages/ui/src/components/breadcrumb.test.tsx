import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Breadcrumb } from './breadcrumb.tsx'

const TRAIL = [
  { label: 'Platform', link: { to: '/platform' } },
  { label: 'Runbooks', link: { to: '/platform/runbooks' } },
  { label: 'Failover' },
]

describe('Breadcrumb', () => {
  it('is a labelled navigation landmark containing an ordered list', async () => {
    const { container } = render(<Breadcrumb items={TRAIL} />)

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('list')).toBeInTheDocument()
    expect(within(nav).getAllByRole('listitem')).toHaveLength(3)
    await expectNoAccessibilityViolations(container)
  })

  /*
   * Regression, review 2026-09-13 C2: the trail was a plain `<a href>`, so a
   * step back to the workspace was a full page load under the identities that
   * render this variant.
   */
  it('renders every step through a supplied `linkComponent`', () => {
    render(
      <Breadcrumb
        items={TRAIL}
        linkComponent={({ to, className, children, ...rest }) => (
          <a href={to} className={className} {...rest} data-routed="true">
            {children}
          </a>
        )}
      />,
    )

    expect(screen.getByRole('link', { name: 'Platform' })).toHaveAttribute('data-routed', 'true')
    expect(screen.getByRole('link', { name: 'Runbooks' })).toHaveAttribute('data-routed', 'true')
  })

  it('links every ancestor and not the current page', () => {
    render(<Breadcrumb items={TRAIL} />)

    expect(screen.getByRole('link', { name: 'Platform' })).toHaveAttribute('href', '/platform')
    expect(screen.getByRole('link', { name: 'Runbooks' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Failover' })).not.toBeInTheDocument()
  })

  it('marks the last item as the current page', () => {
    render(<Breadcrumb items={TRAIL} />)

    expect(screen.getByText('Failover')).toHaveAttribute('aria-current', 'page')
  })

  it('renders an ancestor without a link as plain text', () => {
    render(<Breadcrumb items={[{ label: 'Platform' }, { label: 'Failover' }]} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Platform')).not.toHaveAttribute('aria-current')
  })

  it('hides the separators from assistive technology', () => {
    const { container } = render(<Breadcrumb items={TRAIL} />)

    const separators = [...container.querySelectorAll('[aria-hidden="true"]')]
    expect(separators.map((node) => node.textContent)).toEqual(['/', '/'])

    // The trail itself reads as the three steps and nothing else.
    for (const separator of separators) separator.remove()
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav.textContent).toBe('PlatformRunbooksFailover')
  })

  it('reaches every link from the keyboard', async () => {
    render(<Breadcrumb items={TRAIL} />)

    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Platform' })).toHaveFocus()

    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Runbooks' })).toHaveFocus()
  })

  it('accepts a caller-supplied landmark label and classes', () => {
    render(<Breadcrumb items={TRAIL} label="You are here" className="mb-4" />)

    expect(screen.getByRole('navigation', { name: 'You are here' })).toHaveClass('mb-4')
  })

  it('renders a single item as the current page with no separator', () => {
    render(<Breadcrumb items={[{ label: 'Failover' }]} />)

    expect(screen.getByText('Failover')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('navigation').querySelector('svg')).toBeNull()
  })
})
