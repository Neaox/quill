import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { NestedList } from './nested-list.tsx'
import type { NestedListItem } from './nested-list.tsx'

const ARCHITECTURE: NestedListItem = {
  id: 'a',
  label: 'Architecture',
  link: { to: '/d/$id', params: { id: 'a' } },
  children: [
    {
      id: 'a1',
      label: 'Overview',
      link: { to: '/d/$id', params: { id: 'a1' } },
      children: [{ id: 'a1x', label: 'Deep', link: { to: '/d/$id', params: { id: 'a1x' } } }],
    },
  ],
}
const ITEMS: readonly NestedListItem[] = [ARCHITECTURE, { id: 'b', label: 'Runbooks' }]

describe('NestedList', () => {
  it('lays out every level of a tree as nested lists', () => {
    render(<NestedList items={ITEMS} aria-label="Child documents" />)
    const root = screen.getByRole('list', { name: 'Child documents' })
    expect(within(root).getAllByRole('list')).toHaveLength(2)
    expect(within(root).getAllByRole('listitem')).toHaveLength(4)
  })

  it('draws an entry with a link as a link, resolved from its route, and any other as text', () => {
    render(<NestedList items={ITEMS} />)
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/d/a1')
    expect(screen.queryByRole('link', { name: 'Runbooks' })).toBeNull()
    expect(screen.getByText('Runbooks')).toBeVisible()
  })

  it.each([
    [1, ['Architecture', 'Runbooks']],
    [2, ['Architecture', 'Overview', 'Runbooks']],
    [3, ['Architecture', 'Overview', 'Deep', 'Runbooks']],
    [undefined, ['Architecture', 'Overview', 'Deep', 'Runbooks']],
  ])('draws %s levels', (depth, shown) => {
    render(<NestedList items={ITEMS} depth={depth} />)
    expect(screen.getAllByRole('listitem').map((item) => item.firstChild?.textContent)).toEqual(
      shown,
    )
  })

  it('hands each entry to a renderer when it is given one', () => {
    render(
      <NestedList
        items={ITEMS}
        depth={1}
        renderLabel={(item) => <button type="button">{`Go to ${item.label}`}</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Go to Architecture' })).toBeVisible()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('uses the link component it is given, so an application can route', () => {
    render(
      <NestedList
        items={[ARCHITECTURE]}
        depth={1}
        linkComponent={({ to, className, children }) => (
          <a href={`/routed${to}`} className={className} data-routed="">
            {children}
          </a>
        )}
      />,
    )
    expect(screen.getByRole('link', { name: 'Architecture' })).toHaveAttribute('data-routed')
  })

  it('draws nothing for an empty list, rather than an empty list', () => {
    const { container } = render(<NestedList items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws nothing when no levels are asked for', () => {
    const { container } = render(<NestedList items={ITEMS} depth={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is accessible', async () => {
    const { container } = render(<NestedList items={ITEMS} aria-label="Child documents" />)
    await expectNoAccessibilityViolations(container)
  })
})
