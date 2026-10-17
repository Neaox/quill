import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { VirtualRows } from './virtual-rows.tsx'

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `row-${index}` }))

describe('VirtualRows', () => {
  it('draws only the rows in view, however many there are', () => {
    render(
      <VirtualRows
        label="Workspaces"
        rows={rows(5000)}
        rowKey={(row) => row.id}
        rowHeight={() => 48}
        renderRow={(row) => <span>{row.id}</span>}
      />,
    )

    const drawn = screen.getAllByRole('listitem')
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn.length).toBeLessThan(100)
    expect(screen.getByText('row-0')).toBeInTheDocument()
    expect(screen.queryByText('row-4999')).not.toBeInTheDocument()
  })

  it('says how long the list is, because a window cannot show the rows it does not draw', () => {
    render(
      <VirtualRows
        label="Workspaces"
        rows={rows(300)}
        rowKey={(row) => row.id}
        rowHeight={() => 48}
        renderRow={(row) => <span>{row.id}</span>}
      />,
    )

    expect(screen.getByRole('list', { name: 'Workspaces' })).toBeInTheDocument()
    const first = screen.getAllByRole('listitem')[0]
    expect(first).toHaveAttribute('aria-posinset', '1')
    expect(first).toHaveAttribute('aria-setsize', '300')
  })

  it('takes each row’s own height, so a heading can be shorter than an entry', () => {
    const { container } = render(
      <VirtualRows
        label="Mixed"
        rows={[{ id: 'h' }, { id: 'a' }]}
        rowKey={(row) => row.id}
        rowHeight={(row) => (row.id === 'h' ? 36 : 48)}
        renderRow={(row) => <span>{row.id}</span>}
      />,
    )

    const [heading, entry] = Array.from(container.querySelectorAll('li'))
    expect(heading?.style.getPropertyValue('--start')).toBe('0px')
    expect(entry?.style.getPropertyValue('--start')).toBe('36px')
    expect(heading?.style.getPropertyValue('--size')).toBe('36px')
  })

  describe('in a region that has a measured height', () => {
    const measured = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')

    afterEach(() => {
      if (measured === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
      else Object.defineProperty(HTMLElement.prototype, 'offsetHeight', measured)
    })

    it('draws the rows that height shows, not the height it assumes when it cannot measure', () => {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get: () => 96,
      })
      render(
        <VirtualRows
          label="Workspaces"
          rows={rows(5000)}
          rowKey={(row) => row.id}
          rowHeight={() => 48}
          renderRow={(row) => <span>{row.id}</span>}
        />,
      )

      // Two rows fill 96px, and eight more are drawn beyond the edge so scrolling shows no gap.
      expect(screen.getAllByRole('listitem')).toHaveLength(10)
    })
  })
})
