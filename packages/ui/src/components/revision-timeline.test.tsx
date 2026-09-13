import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { ThemeVariantsProvider } from '../theme/theme-variants.tsx'
import { linkHref, type LinkComponent } from '../lib/link.tsx'
import { RevisionTimeline, type Revision } from './revision-timeline.tsx'

const REVISIONS: readonly Revision[] = [
  { id: 'v12', label: 'v12', at: '2026-08-15', link: { to: '#v12' } },
  { id: 'v11', label: 'v11', at: '2026-07-02', link: { to: '#v11' } },
  { id: 'v10', label: 'v10', at: '2026-06-19', link: { to: '#v10' } },
]

/** A `linkComponent` that resolves the target itself, so a test can tell it was used. */
const StubLink: LinkComponent = ({ to, params, search, hash, children, ...rest }) => (
  <a href={linkHref({ to, params, search, hash })} {...rest} data-routed="true">
    {children}
  </a>
)

describe('RevisionTimeline', () => {
  it('lists every publish in order, as links, under the default identity', async () => {
    const { container } = render(<RevisionTimeline revisions={REVISIONS} currentId="v12" />)

    const region = screen.getByRole('region', { name: 'Revisions' })
    expect(region).toHaveAttribute('data-history', 'timeline')
    expect(within(region).getAllByRole('listitem')).toHaveLength(3)
    expect(within(region).getByText('2026-07-02')).toHaveAttribute('datetime', '2026-07-02')
    await expectNoAccessibilityViolations(container)
  })

  it('says which revision is current rather than only colouring its tick', () => {
    render(<RevisionTimeline revisions={REVISIONS} currentId="v11" />)

    const current = screen.getByRole('link', { name: /v11/ })
    expect(current).toHaveAttribute('aria-current', 'true')
    expect(within(current).getByText('current revision')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /v12/ })).not.toHaveAttribute('aria-current')
  })

  it('puts the same list behind a control for an identity that asks for a menu', async () => {
    const { container } = render(
      <ThemeVariantsProvider themeId="press">
        <RevisionTimeline revisions={REVISIONS} currentId="v12" />
      </ThemeVariantsProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'History' })
    expect(screen.queryByRole('link', { name: /v12/ })).not.toBeInTheDocument()
    await expectNoAccessibilityViolations(container)

    await userEvent.click(trigger)

    const panel = await screen.findByRole('dialog', { name: 'Revisions' })
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3)
  })

  /*
   * Regression, review 2026-09-13 C1: the ticks were plain `<a href>`, so
   * reading an older revision in the application restarted the whole
   * single-page app — the query cache discarded, the sidebar's scroll lost.
   * The seam is the same one `Tree` and `IconRail` already had.
   */
  it('renders every tick through a supplied `linkComponent`, in both variants', async () => {
    const { rerender } = render(
      <RevisionTimeline revisions={REVISIONS} currentId="v12" linkComponent={StubLink} />,
    )
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('data-routed', 'true')
    }

    rerender(
      <RevisionTimeline
        revisions={REVISIONS}
        currentId="v12"
        variant="menu"
        linkComponent={StubLink}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    const panel = await screen.findByRole('dialog', { name: 'Revisions' })
    for (const link of within(panel).getAllByRole('link')) {
      expect(link).toHaveAttribute('data-routed', 'true')
    }
  })

  it('describes a destination as a route and its parameters, never as a built href', () => {
    render(
      <RevisionTimeline
        currentId="r1"
        revisions={[
          {
            id: 'r1',
            label: 'v12',
            at: '2026-08-15',
            link: {
              to: '/w/$workspaceSlug/d/$documentId',
              params: { workspaceSlug: 'engineering', documentId: 'failover-k7m3q9v2xd' },
              search: { rev: 'r1' },
            },
          },
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: /v12/ })).toHaveAttribute(
      'href',
      '/w/engineering/d/failover-k7m3q9v2xd?rev=r1',
    )
  })

  it('takes its own names when a caller supplies them', async () => {
    render(
      <RevisionTimeline
        revisions={REVISIONS}
        currentId="v12"
        variant="menu"
        label="Published revisions"
        triggerLabel="Revisions"
        className="ms-2"
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Revisions' }))

    expect(await screen.findByRole('dialog', { name: 'Published revisions' })).toBeInTheDocument()
  })
})
