import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { ThemeVariantsProvider } from '../theme/theme-variants.tsx'
import { linkHref, type LinkComponent } from '../lib/link.tsx'
import { DocumentHeader, type DocumentStatus } from './document-header.tsx'

const STATUS: DocumentStatus = {
  path: [
    { label: 'acme', link: { to: '#acme' } },
    { label: 'engineering', link: { to: '#engineering' } },
    { label: 'architecture', link: { to: '#architecture' } },
    { label: 'authentication' },
  ],
  version: 'v12',
  updated: '2026-08-15',
  owner: 'platform',
  state: 'published',
}

/** A `linkComponent` that resolves the target itself, so a test can tell it was used. */
const StubLink: LinkComponent = ({ to, params, search, hash, children, ...rest }) => (
  <a href={linkHref({ to, params, search, hash })} {...rest} data-routed="true">
    {children}
  </a>
)

describe('DocumentHeader', () => {
  it('is a banner carrying the path, the state, the revision, and the owner', async () => {
    const { container } = render(<DocumentHeader status={STATUS} />)

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByText('authentication')).toBeInTheDocument()
    expect(screen.getByText('published')).toBeInTheDocument()
    expect(screen.getByText('owner: platform')).toBeInTheDocument()
    expect(screen.getByText('2026-08-15')).toHaveAttribute('datetime', '2026-08-15')
    await expectNoAccessibilityViolations(container)
  })

  it('takes the readout variant from the default identity', () => {
    render(<DocumentHeader status={STATUS} />)

    expect(screen.getByRole('banner')).toHaveAttribute('data-header', 'readout')
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
  })

  it('shows the trail as a breadcrumb under an identity that asks for one', async () => {
    const { container } = render(
      <ThemeVariantsProvider themeId="press">
        <DocumentHeader status={STATUS} />
      </ThemeVariantsProvider>,
    )

    expect(screen.getByRole('banner')).toHaveAttribute('data-header', 'breadcrumb')
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(trail).toBeInTheDocument()
    expect(screen.getByText('authentication')).toHaveAttribute('aria-current', 'page')
    await expectNoAccessibilityViolations(container)
  })

  /*
   * Regression, review 2026-09-13 C2: the readout rendered every step as
   * text and dropped the destination, so the one route back to the workspace
   * was dead under the default identity while it worked under the other two.
   */
  it('links the readout ancestors, and leaves a step with no destination as text', async () => {
    const { container } = render(
      <DocumentHeader
        status={{ path: [{ label: 'acme', link: { to: '#acme' } }, { label: 'authentication' }] }}
      />,
    )

    expect(screen.getByRole('banner')).toHaveAttribute('data-header', 'readout')
    expect(screen.getByRole('link', { name: 'acme' })).toHaveAttribute('href', '#acme')
    expect(screen.queryByRole('link', { name: 'authentication' })).not.toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('leaves an ancestor with no destination as text, rather than as a link to nowhere', () => {
    render(
      <DocumentHeader
        status={{ path: [{ label: 'acme' }, { label: 'engineering' }, { label: 'failover' }] }}
      />,
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('acme')).toBeInTheDocument()
    expect(screen.getByText('engineering')).toBeInTheDocument()
  })

  it('hands its `linkComponent` to both variants', () => {
    const { rerender } = render(<DocumentHeader status={STATUS} linkComponent={StubLink} />)
    expect(screen.getByRole('link', { name: 'acme' })).toHaveAttribute('data-routed', 'true')

    rerender(<DocumentHeader status={STATUS} variant="breadcrumb" linkComponent={StubLink} />)
    expect(screen.getByRole('link', { name: 'acme' })).toHaveAttribute('data-routed', 'true')
  })

  it('lets a preview ask for the other variant directly', () => {
    render(<DocumentHeader status={STATUS} variant="breadcrumb" />)

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
  })

  it('says the state in words as well as with the accent dot', () => {
    render(<DocumentHeader status={{ ...STATUS, state: 'draft' }} />)

    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('renders the mark and the actions only when they are given', () => {
    const { rerender } = render(<DocumentHeader status={STATUS} />)
    expect(screen.queryByText('AC')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()

    rerender(
      <DocumentHeader
        status={STATUS}
        mark={<span>AC</span>}
        actions={<button type="button">Edit</button>}
      />,
    )
    expect(screen.getByText('AC')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })
  it('shows only the facts it was given, and no list at all when there are none', () => {
    // The same bar stands above a place that is not a document — a workspace's
    // own home — which has a trail and nothing else. A fact the platform
    // cannot answer is not shown as a dash.
    const { rerender } = render(<DocumentHeader status={{ path: [{ label: 'Engineering' }] }} />)

    expect(screen.getByText('Engineering')).toBeInTheDocument()
    expect(screen.queryByRole('term')).not.toBeInTheDocument()

    rerender(<DocumentHeader status={{ path: [{ label: 'Engineering' }], state: 'published' }} />)
    expect(screen.getByText('published')).toBeInTheDocument()
    expect(screen.queryByText(/^owner:/)).not.toBeInTheDocument()
  })

  it('shows a lone revision fact without a state row or a separator', () => {
    const { container } = render(
      <DocumentHeader status={{ path: [{ label: 'Engineering' }], version: 'v3' }} />,
    )

    expect(screen.getByText('v3')).toBeInTheDocument()
    expect(container.querySelector('time')).not.toBeInTheDocument()
    expect(screen.getAllByRole('term')).toHaveLength(1)
    expect(screen.getByRole('definition').textContent).toBe('v3')
  })
})
