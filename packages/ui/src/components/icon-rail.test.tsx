import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { linkHref, type LinkComponent } from '../lib/link.tsx'
import { IconRail, type IconRailItem } from './icon-rail.tsx'
import { CommentIcon, HistoryIcon, OutlineIcon, SearchIcon } from './icons.tsx'

const ITEMS: readonly IconRailItem[] = [
  { id: 'outline', label: 'Documents', icon: <OutlineIcon />, link: { to: '#documents' } },
  { id: 'search', label: 'Search', icon: <SearchIcon />, link: { to: '#search' } },
  { id: 'history', label: 'History', icon: <HistoryIcon />, link: { to: '#history' } },
  { id: 'comments', label: 'Comments', icon: <CommentIcon />, link: { to: '#comments' } },
]

/** A `linkComponent` that resolves the target itself, so a test can tell it was used. */
const StubLink: LinkComponent = ({ to, params, search, hash, children, ...rest }) => (
  <a href={linkHref({ to, params, search, hash })} {...rest} data-stub-link="true">
    {children}
  </a>
)

describe('IconRail', () => {
  it('names every control, because the icon carries none of the meaning', async () => {
    const { container } = render(<IconRail label="Workspace" items={ITEMS} />)

    const rail = screen.getByRole('navigation', { name: 'Workspace' })
    expect(rail).toBeInTheDocument()
    for (const item of ITEMS) {
      expect(screen.getByRole('link', { name: item.label })).toBeInTheDocument()
    }
    await expectNoAccessibilityViolations(container)
  })

  it('marks the current section, and only that one', () => {
    render(<IconRail label="Workspace" items={ITEMS} currentId="history" />)

    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Search' })).not.toHaveAttribute('aria-current')
  })

  it('renders no footer when none is given', () => {
    render(<IconRail label="Workspace" items={ITEMS} />)

    expect(screen.queryByText('MR')).not.toBeInTheDocument()
  })

  it('pins a footer to the far end', async () => {
    const { container } = render(
      <IconRail label="Workspace" items={ITEMS} footer={<span>MR</span>} />,
    )

    expect(screen.getByText('MR')).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })
  it('renders links through a supplied `linkComponent` instead of a plain anchor', () => {
    render(
      <IconRail label="Workspace" items={ITEMS} currentId="history" linkComponent={StubLink} />,
    )

    const current = screen.getByRole('link', { name: 'History' })
    expect(current).toHaveAttribute('data-stub-link', 'true')
    expect(current).toHaveAttribute('aria-current', 'page')
  })
})
