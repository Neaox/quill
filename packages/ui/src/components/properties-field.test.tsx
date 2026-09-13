import { render, screen } from '@testing-library/react'
import type { ChangeEvent } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { PropertyReadout, PropertySelect } from './properties-field.tsx'

const STATUSES = [
  { value: '', label: 'Not set' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
]

describe('PropertySelect', () => {
  it('associates its label with the control, and shows the value it is given', async () => {
    const { container } = render(
      <PropertySelect label="Status" value="draft" options={STATUSES} onChange={() => undefined} />,
    )

    expect(screen.getByLabelText('Status')).toHaveValue('draft')
    expect(screen.getByRole('option', { name: 'Not set' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('reports a choice', async () => {
    const onChange = vi.fn<(event: ChangeEvent<HTMLSelectElement>) => void>()
    render(<PropertySelect label="Status" value="draft" options={STATUSES} onChange={onChange} />)

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'published')

    expect(onChange).toHaveBeenCalled()
  })

  it('is valid and undescribed when it has neither description nor error', () => {
    render(<PropertySelect label="Status" value="" options={STATUSES} onChange={() => undefined} />)

    const field = screen.getByLabelText('Status')
    expect(field).toHaveAttribute('aria-invalid', 'false')
    expect(field).not.toHaveAttribute('aria-describedby')
  })

  it('describes the control, and says what is wrong with it', async () => {
    const { container } = render(
      <PropertySelect
        label="Status"
        value=""
        options={STATUSES}
        description="How far along the document is."
        error="Choose a status before publishing."
        onChange={() => undefined}
      />,
    )

    const field = screen.getByLabelText('Status')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(
      'How far along the document is. Choose a status before publishing.',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a status before publishing.')
    await expectNoAccessibilityViolations(container)
  })

  it('cannot be used when it is disabled', () => {
    render(
      <PropertySelect
        label="Status"
        value="draft"
        options={STATUSES}
        disabled
        onChange={() => undefined}
      />,
    )

    expect(screen.getByLabelText('Status')).toBeDisabled()
  })
})

describe('PropertyReadout', () => {
  it('associates a label with a value that is shown rather than edited', async () => {
    const { container } = render(
      <PropertyReadout label="Title" description="The first heading is the title.">
        Regional failover
      </PropertyReadout>,
    )

    expect(screen.getByText('Title')).toBeVisible()
    expect(screen.getByText('Regional failover')).toBeVisible()
    expect(screen.getByText('The first heading is the title.')).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('needs no description', () => {
    render(<PropertyReadout label="Title">Regional failover</PropertyReadout>)

    expect(screen.getByText('Regional failover')).toBeVisible()
  })
})
