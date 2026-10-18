import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { RevisionPicker, type RevisionChoice } from './revision-picker.tsx'

const CHOICES: readonly RevisionChoice[] = [
  { id: 'draft', label: 'Your draft', tag: 'Draft' },
  {
    id: 'v3',
    label: 'v3',
    at: '2026-10-03',
    author: 'Ada',
    note: 'Tightened the steps',
    tag: 'Latest',
  },
  { id: 'v2', label: 'v2', at: '2026-09-21', author: 'Sam' },
  { id: 'v1', label: 'v1', at: '2026-09-01', author: 'Ada', note: 'First draft' },
]

function Harness({ initial = 'v2' }: { readonly initial?: string }) {
  const [value, setValue] = useState(initial)
  return <RevisionPicker label="From" value={value} choices={CHOICES} onValueChange={setValue} />
}

const said = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))

describe('RevisionPicker', () => {
  it('names the side and the version it is set to', async () => {
    const { container } = render(<Harness />)
    const trigger = screen.getByRole('button', { name: `From: v2, ${said('2026-09-21')}` })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expectNoAccessibilityViolations(container)
  })

  it('lists every version with who, when and why, the chosen one checked', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /^From/ }))

    const menu = await screen.findByRole('menu', { name: 'From' })
    const options = within(menu).getAllByRole('menuitemradio')
    expect(options).toHaveLength(4)
    expect(options[2]).toHaveAttribute('aria-checked', 'true')
    expect(within(options[1] ?? menu).getByText(/Ada · Tightened the steps/)).toBeInTheDocument()
    expect(within(options[1] ?? menu).getByText('Latest')).toBeInTheDocument()
    expect(within(options[3] ?? menu).getByRole('time')).toHaveAttribute(
      'datetime',
      new Date('2026-09-01').toISOString(),
    )
    await expectNoAccessibilityViolations(menu)
  })

  it('opens on the chosen version, is chosen from with the keyboard, and closes on the choice', async () => {
    render(<Harness />)
    screen.getByRole('button', { name: /^From/ }).focus()
    await userEvent.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: 'From' })
    await waitFor(() => {
      expect(within(menu).getByRole('menuitemradio', { name: /^v2/ })).toHaveFocus()
    })
    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^From: v1/ })).toHaveFocus()
  })

  it('will not choose a version it was told is unavailable', async () => {
    render(
      <RevisionPicker
        label="To"
        value="v3"
        choices={CHOICES.map((choice) =>
          choice.id === 'v1' ? { ...choice, disabled: true } : choice,
        )}
        onValueChange={() => {
          throw new Error('should not be chosen')
        }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /^To/ }))
    const menu = await screen.findByRole('menu', { name: 'To' })
    expect(within(menu).getByRole('menuitemradio', { name: /v1/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('says so when the value is not among the choices, and opens without a version to land on', async () => {
    render(
      <RevisionPicker
        label="From"
        value="gone"
        choices={CHOICES}
        onValueChange={() => undefined}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'From: none' })
    expect(trigger).toHaveTextContent('Choose a version')

    await userEvent.click(trigger)
    const menu = await screen.findByRole('menu', { name: 'From' })
    expect(within(menu).queryByRole('menuitemradio', { checked: true })).not.toBeInTheDocument()
  })

  it('names a version by its label alone when its date is not one', () => {
    render(
      <RevisionPicker
        label="To"
        value="odd"
        choices={[{ id: 'odd', label: 'v9', at: 'not a date' }]}
        onValueChange={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'To: v9' })).toBeInTheDocument()
  })

  it('names a draft, which has no publish date, by its label alone', () => {
    render(<Harness initial="draft" />)
    expect(screen.getByRole('button', { name: 'From: Your draft' })).toBeInTheDocument()
  })
})
