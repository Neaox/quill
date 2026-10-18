import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ContrastTable } from './contrast-table.tsx'

describe('the contrast table', () => {
  it('reports contrast for every pair, in both schemes, from the generator itself', () => {
    render(<ContrastTable themeId="instrument" />)

    const table = screen.getByRole('table', { name: /Generated from this identity/ })
    const row = within(table).getByRole('rowheader', { name: 'foreground on background' })
    const cells = row.parentElement?.querySelectorAll('td') ?? []

    expect(cells[0]?.textContent).toMatch(/^\d+\.\d\d:1$/)
    expect(cells[1]?.textContent).toMatch(/^\d+\.\d\d:1$/)
    expect(cells[3]?.textContent).toBe('pass')
  })
})
