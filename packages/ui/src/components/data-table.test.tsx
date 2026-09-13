import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { DataTable } from './data-table.tsx'
import { ScrollGroup } from './scroll-group.tsx'

function Rows() {
  return (
    <>
      <thead>
        <tr>
          <th scope="col">endpoint</th>
          <th scope="col">budget</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">/auth/token</th>
          <td>120 ms</td>
        </tr>
        <tr>
          <th scope="row">/auth/refresh</th>
          <td>80 ms</td>
        </tr>
      </tbody>
    </>
  )
}

describe('DataTable', () => {
  it('owns the table element, so the treatment cannot be half-copied', async () => {
    const { container } = render(
      <DataTable label="Endpoints">
        <Rows />
      </DataTable>,
    )

    const table = screen.getByRole('table')
    expect(table).toHaveClass('data-table')
    expect(within(table).getAllByRole('rowheader')).toHaveLength(2)
    await expectNoAccessibilityViolations(container)
  })

  it('is reachable from the keyboard, because it scrolls', async () => {
    render(
      <DataTable label="Endpoints" className="mt-4">
        <Rows />
      </DataTable>,
    )

    await userEvent.tab()
    expect(screen.getByRole('group', { name: 'Endpoints' })).toHaveFocus()
  })

  it('carries a caption when one is given, and none when it is not', async () => {
    const { container, rerender } = render(
      <DataTable label="Endpoints">
        <Rows />
      </DataTable>,
    )
    expect(container.querySelector('caption')).toBeNull()

    rerender(
      <DataTable label="Endpoints" caption="Latency budgets, ninety-fifth percentile">
        <Rows />
      </DataTable>,
    )
    expect(screen.getByRole('table', { name: /Latency budgets/ })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })
})

describe('ScrollGroup', () => {
  it('is one labelled, focusable, scrolling region wherever it is used', async () => {
    const { container } = render(
      <ScrollGroup label="A long diagram">
        <p>Content wider than its container.</p>
      </ScrollGroup>,
    )

    const group = screen.getByRole('group', { name: 'A long diagram' })
    expect(group).toHaveClass('overflow-x-auto')
    await userEvent.tab()
    expect(group).toHaveFocus()
    await expectNoAccessibilityViolations(container)
  })
})
