import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { CommandPalette, positionOptions, type CommandPaletteGroup } from './command-palette.tsx'

const GROUPS: readonly CommandPaletteGroup[] = [
  {
    id: 'current',
    label: 'In this workspace',
    options: [
      { id: 'a', content: <span>Regional failover</span> },
      { id: 'b', content: <span>Authentication architecture</span> },
    ],
  },
  {
    id: 'platform-docs',
    label: 'Platform docs',
    options: [{ id: 'c', content: <span>Platform team charter</span> }],
  },
]

function palette(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  return (
    <CommandPalette
      open
      onOpenChange={() => {}}
      title="Search"
      inputLabel="Search documents"
      value=""
      onValueChange={() => {}}
      groups={GROUPS}
      onSelect={() => {}}
      {...overrides}
    />
  )
}

function field(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Search documents' })
}

describe('positionOptions', () => {
  it('numbers every option across the groups in the order they are rendered', () => {
    const { groups, ids } = positionOptions(GROUPS)

    expect(ids).toEqual(['a', 'b', 'c'])
    expect(groups.map((group) => group.options.map((option) => option.position))).toEqual([
      [0, 1],
      [2],
    ])
  })

  it('is empty when every group is', () => {
    expect(positionOptions([{ id: 'current', label: 'Empty', options: [] }]).ids).toEqual([])
  })
})

describe('CommandPalette', () => {
  it('renders nothing at all until it is opened', () => {
    render(palette({ open: false }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens as a named dialog with the field focused, and is free of axe violations', async () => {
    render(palette())

    const dialog = await screen.findByRole('dialog', { name: 'Search' })
    expect(field()).toHaveFocus()
    expect(within(dialog).getAllByRole('option')).toHaveLength(3)
    await expectNoAccessibilityViolations(dialog)
  })

  it('names every group, so a hit says which workspace it is in', async () => {
    render(palette())

    const groups = await screen.findAllByRole('group')

    expect(
      groups.map((group) => {
        const labelledBy = group.getAttribute('aria-labelledby') ?? ''
        return document.getElementById(labelledBy)?.textContent
      }),
    ).toEqual(['In this workspace', 'Platform docs'])
  })

  it('starts with the first option active and points the field at it', async () => {
    render(palette())

    const options = await screen.findAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(field()).toHaveAttribute('aria-activedescendant', options[0]?.id)
  })

  it('moves the active option across group boundaries without moving focus', async () => {
    render(palette())
    await screen.findAllByRole('option')

    await userEvent.keyboard('{ArrowDown}{ArrowDown}')

    const options = screen.getAllByRole('option')
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    expect(field()).toHaveAttribute('aria-activedescendant', options[2]?.id)
    expect(field()).toHaveFocus()
  })

  it('stops at both ends rather than wrapping, and Home and End reach them at once', async () => {
    render(palette())
    await screen.findAllByRole('option')

    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{End}')
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{Home}')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('selects the active option on Enter, by the id the caller gave it', async () => {
    const onSelect = vi.fn<(id: string) => void>()
    render(palette({ onSelect }))
    await screen.findAllByRole('option')

    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('selects the option a pointer chooses', async () => {
    const onSelect = vi.fn<(id: string) => void>()
    render(palette({ onSelect }))

    await userEvent.click(await screen.findByRole('option', { name: 'Platform team charter' }))

    expect(onSelect).toHaveBeenCalledWith('c')
  })

  it('selects nothing when Enter is pressed with no option to land on', async () => {
    const onSelect = vi.fn<(id: string) => void>()
    render(palette({ onSelect, groups: [], notice: <p>No matches</p> }))
    await screen.findByRole('dialog')

    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onSelect).not.toHaveBeenCalled()
    expect(field()).not.toHaveAttribute('aria-activedescendant')
  })

  it('reports what is typed and returns the active option to the top', async () => {
    const onValueChange = vi.fn<(value: string) => void>()
    const { rerender } = render(palette({ onValueChange }))
    await screen.findAllByRole('option')

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    await userEvent.type(field(), 'f')
    expect(onValueChange).toHaveBeenLastCalledWith('f')

    rerender(palette({ onValueChange, value: 'f' }))
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>()
    render(palette({ onOpenChange }))
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('says it is busy on the field itself while an answer is on the way', async () => {
    const { rerender } = render(palette({ busy: true }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(field()).toHaveAttribute('aria-busy', 'true')

    rerender(palette({ busy: false }))
    expect(field()).toHaveAttribute('aria-busy', 'false')
  })

  it('shows a notice instead of a list, and never an empty listbox', async () => {
    render(palette({ groups: [], notice: <p>Nothing matched “zzz”.</p> }))

    expect(await screen.findByText('Nothing matched “zzz”.')).toBeVisible()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(field()).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders a footer the caller supplies, outside the listbox', async () => {
    render(palette({ footer: <button type="button">See all results</button> }))
    const dialog = await screen.findByRole('dialog')

    const footer = within(dialog).getByRole('button', { name: 'See all results' })
    expect(footer).toBeVisible()
    expect(within(dialog).getByRole('listbox')).not.toContainElement(footer)
  })

  it('shows the placeholder and description the caller gives the field', async () => {
    render(palette({ placeholder: 'Search documentation', description: 'Enter opens a document' }))

    expect(await screen.findByPlaceholderText('Search documentation')).toBe(field())
    expect(field()).toHaveAccessibleDescription('Enter opens a document')
  })

  it('keeps the option the arrows reach in view', async () => {
    // jsdom implements no layout, so `vitest.setup.ts` stands a no-op in for
    // `scrollIntoView`; this replaces that one for the length of the test, so
    // the call the palette makes is actually observed.
    const shim = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      render(palette())
      await screen.findAllByRole('option')

      await userEvent.keyboard('{ArrowDown}')

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      Element.prototype.scrollIntoView = shim
    }
  })
})
