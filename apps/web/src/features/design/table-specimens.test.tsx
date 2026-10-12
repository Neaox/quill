import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { TABLE_SPECIMENS } from './table-specimens.gen.ts'
import { TableSpecimens } from './table-specimens.tsx'

describe('the table specimens (ADR-040)', () => {
  it('shows every feature, each named and captioned with what it shows', async () => {
    render(<TableSpecimens />)

    expect(TABLE_SPECIMENS.map((specimen) => specimen.id)).toEqual([
      'widths',
      'columns',
      'caption',
      'caption-bottom',
      'row-headers',
      'row-headers-only',
      'footer',
      'frozen',
      'sorting',
      'shadows',
      'stack',
      'viewer',
      'numeric',
    ])
    for (const specimen of TABLE_SPECIMENS) {
      expect(screen.getByRole('region', { name: specimen.label })).toHaveTextContent(specimen.note)
    }
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^Expand table/u }).length).toBeGreaterThan(0)
    })
  })

  it('sorts as a reader would, and switches the widths between the two alignments', async () => {
    const user = userEvent.setup()
    const { container } = render(<TableSpecimens />)

    const downloads = await screen.findByRole('button', { name: 'Downloads' })
    await user.click(downloads)
    expect(downloads.closest('th')).toHaveAttribute('aria-sort', 'ascending')

    expect(container.firstElementChild).toHaveAttribute('data-align', 'start')
    await user.click(screen.getByRole('radio', { name: 'Centred' }))
    expect(container.firstElementChild).toHaveAttribute('data-align', 'centre')
  })

  it('has no axe violations', async () => {
    const { container } = render(<TableSpecimens />)

    await screen.findByRole('button', { name: 'Downloads' })
    await expectNoAccessibilityViolations(container)
  })
})
