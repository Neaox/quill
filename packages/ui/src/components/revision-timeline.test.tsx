import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  it('offers each revision a comparison with the one before it', async () => {
    const { container } = render(
      <RevisionTimeline
        revisions={REVISIONS.map((revision, index) =>
          index === REVISIONS.length - 1
            ? revision
            : { ...revision, compare: { to: '#compare', search: { to: revision.id } } },
        )}
        currentId="v12"
      />,
    )

    expect(
      screen.getByRole('link', { name: 'Compare v12 with the previous version' }),
    ).toHaveAttribute('href', '#compare?to=v12')
    expect(screen.queryByRole('link', { name: 'Compare v10 with the previous version' })).toBeNull()
    await expectNoAccessibilityViolations(container)
  })

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

/*
 * The popover's machinery arrives on demand (quill-plan.md section 31). The
 * tests above run with it already here (`vitest.setup.ts`); this loads a fresh
 * timeline whose popover has not arrived, and decides when it does.
 */
describe('a history popover whose machinery has not arrived yet', () => {
  afterEach(() => {
    vi.doUnmock('./popover-panels.tsx')
  })

  it('draws the closed control, holds a press, and opens once it arrives', async () => {
    vi.resetModules()
    const { promise: arrived, resolve: arrive } = Promise.withResolvers<void>()
    vi.doMock('./popover-panels.tsx', async () => {
      await arrived
      return vi.importActual('./popover-panels.tsx')
    })
    const { RevisionTimeline: FreshTimeline } = await import('./revision-timeline.tsx')
    const { container } = render(
      <FreshTimeline revisions={REVISIONS} currentId="v12" variant="menu" />,
    )

    const trigger = screen.getByRole('button', { name: 'History' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expectNoAccessibilityViolations(container)

    await userEvent.click(trigger)
    expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-busy', 'true')

    arrive()
    const panel = await screen.findByRole('dialog', { name: 'Revisions' })
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3)
  })
})

/*
 * The trigger is never replaced by the machinery (2026-10-17): a press in the
 * same task as the module arriving lands on the control that is still the
 * trigger afterwards, which opens, says so, and gets focus back on Escape.
 */
describe('a history popover pressed as its machinery arrives', () => {
  afterEach(() => {
    vi.doUnmock('./popover-panels.tsx')
  })

  it('opens from the same trigger element, and returns focus to it', async () => {
    vi.resetModules()
    const { promise: arrived, resolve: arrive } = Promise.withResolvers<void>()
    vi.doMock('./popover-panels.tsx', async () => {
      await arrived
      return vi.importActual('./popover-panels.tsx')
    })
    const fresh = await import('./revision-timeline.tsx')
    render(<fresh.RevisionTimeline revisions={REVISIONS} currentId="v12" variant="menu" />)
    const trigger = screen.getByRole('button', { name: 'History' })

    await act(async () => {
      const loading = fresh.preloadPopovers()
      arrive()
      await loading
      fireEvent.pointerDown(trigger)
      fireEvent.click(trigger)
    })

    expect(await screen.findByRole('dialog', { name: 'Revisions' })).toBeInTheDocument()
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Revisions' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
