import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LevelSelect } from './level-select.tsx'

const OPTIONS = [
  { value: 1, label: 'One' },
  { value: 2, label: 'Two' },
  { value: 3, label: 'Three' },
] as const

function setup(onChange = vi.fn<(value: 1 | 2 | 3) => void>()) {
  render(<LevelSelect label="Depth" value={2} options={OPTIONS} onChange={onChange} />)
  return { onChange, select: screen.getByRole('combobox', { name: 'Depth' }) }
}

describe('a labelled choice among a few values', () => {
  it('is named by visible text and shows the value it has', () => {
    const { select } = setup()
    expect(select).toHaveValue('2')
    expect(screen.getByText('Depth')).toBeVisible()
  })

  it('reports the typed value of the option that was chosen, not its text', async () => {
    const { select, onChange } = setup()
    await userEvent.selectOptions(select, 'Three')
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('ignores a value it did not offer', () => {
    const { select, onChange } = setup()
    fireEvent.change(select, { target: { value: '99' } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
