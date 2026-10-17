import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Combobox, type ComboboxProps } from './combobox.tsx'
import type { ListboxGroup } from './listbox.tsx'

const GROUPS: readonly ListboxGroup[] = [
  {
    id: 'documents',
    label: 'Documents',
    options: [
      { id: 'sync', label: 'The sync map', detail: 'Engineering · Architecture' },
      { id: 'limits', label: 'Rate limits', detail: 'Engineering · Reference' },
    ],
  },
  { id: 'collections', label: 'Collections', options: [{ id: 'guides', label: 'Guides' }] },
]

function Harness(props: Partial<ComboboxProps>) {
  const [value, setValue] = useState('')
  return (
    <Combobox
      label="Links to"
      value={value}
      onValueChange={setValue}
      groups={GROUPS}
      onSelect={() => {}}
      {...props}
    />
  )
}

const field = () => screen.getByRole('combobox', { name: 'Links to' })

describe('Combobox', () => {
  it('is a labelled combobox whose popup is closed until it is used', () => {
    render(<Harness />)
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    expect(field()).toHaveAttribute('aria-autocomplete', 'list')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens as somebody types, and walks the options with the arrows without leaving the field', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn<(id: string) => void>()
    render(<Harness onSelect={onSelect} />)
    await user.type(field(), 's')
    expect(field()).toHaveAttribute('aria-expanded', 'true')
    const listbox = screen.getByRole('listbox', { name: 'Links to' })
    expect(field()).toHaveAttribute('aria-controls', listbox.id)

    const first = screen.getByRole('option', { name: 'The sync map' })
    expect(field()).toHaveAttribute('aria-activedescendant', first.id)
    expect(first).toHaveAccessibleDescription('Engineering · Architecture')

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    // It stops at the end rather than wrapping.
    expect(field()).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Guides' }).id,
    )
    await user.keyboard('{ArrowUp}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('limits')
    expect(field()).toHaveFocus()
    expect(field()).toHaveAttribute('aria-expanded', 'false')
  })

  it('chooses an option by pointer without the field losing focus first', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn<(id: string) => void>()
    render(<Harness onSelect={onSelect} />)
    await user.type(field(), 'g')
    await user.click(screen.getByRole('option', { name: 'Guides' }))
    expect(onSelect).toHaveBeenCalledWith('guides')
  })

  it('stays open after an option the caller says is a step rather than an answer', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn<(id: string) => void>()
    render(<Harness onSelect={onSelect} keepsOpen={(id) => id === 'sync'} />)
    await user.type(field(), 'x')

    await user.click(screen.getByRole('option', { name: 'The sync map' }))
    expect(onSelect).toHaveBeenCalledWith('sync')
    expect(field()).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('option', { name: 'Guides' }))
    expect(field()).toHaveAttribute('aria-expanded', 'false')
  })

  it('without a preselected option leaves Enter alone until the arrows reach one', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn<(id: string) => void>()
    render(<Harness onSelect={onSelect} preselect={false} />)
    await user.type(field(), 'x')

    expect(field()).toHaveAttribute('aria-expanded', 'true')
    expect(field()).not.toHaveAttribute('aria-activedescendant')
    await user.keyboard('{Enter}')
    expect(onSelect).not.toHaveBeenCalled()

    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('sync')
  })

  it('closes on Escape, and a second Escape is the caller’s to answer', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn<() => void>()
    render(<Harness onDismiss={onDismiss} />)
    await user.type(field(), 's')
    await user.keyboard('{Escape}')
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    expect(onDismiss).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onDismiss).toHaveBeenCalledOnce()
    await user.keyboard('{ArrowDown}')
    expect(field()).toHaveAttribute('aria-expanded', 'true')
  })

  it('leaves Enter and a second Escape to the page while there is nothing to choose', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn<(id: string) => void>()
    // The keys the combobox kept for itself, as the page around it sees them.
    const handled: string[] = []
    const record = (event: KeyboardEvent) => {
      if (event.defaultPrevented) handled.push(event.key)
    }
    document.addEventListener('keydown', record)
    onTestFinished(() => {
      document.removeEventListener('keydown', record)
    })
    const { rerender } = render(<Harness onSelect={onSelect} />)
    await user.click(field())
    await user.keyboard('{Escape}')
    expect(handled).toEqual(['Escape'])
    // Closed, with no `onDismiss`: a form may still submit, a dialog may still close.
    await user.keyboard('{Enter}{Escape}')
    expect(handled).toEqual(['Escape'])
    expect(field()).toHaveAttribute('aria-expanded', 'false')

    // Open, but saying "Searching…" rather than offering anything.
    rerender(<Harness onSelect={onSelect} groups={[]} notice="Searching…" />)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByText('Searching…')).toBeVisible()
    await user.keyboard('{Enter}')
    expect(handled).toEqual(['Escape', 'ArrowDown'])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('opens from the keyboard on ArrowDown only, not ArrowUp', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())
    await user.keyboard('{Escape}{ArrowUp}')
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowDown}')
    expect(field()).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes when somebody leaves the field', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(field(), 's')
    expect(field()).toHaveAttribute('aria-expanded', 'true')
    await user.tab()
    expect(field()).not.toHaveFocus()
    expect(field()).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows its placeholder and hands the caller its field to focus', () => {
    const inputRef = createRef<HTMLInputElement>()
    render(<Harness placeholder="Search documents" inputRef={inputRef} />)
    expect(field()).toHaveAttribute('placeholder', 'Search documents')
    expect(inputRef.current).toBe(field())
  })

  it('says why there is nothing to choose, instead of opening an empty box', async () => {
    const user = userEvent.setup()
    render(<Harness groups={[]} notice="Nothing matches “zz”." status="No results" />)
    await user.type(field(), 'zz')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('Nothing matches “zz”.')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('No results')
  })

  it('stays closed with nothing to show and nothing to say', async () => {
    const user = userEvent.setup()
    render(<Harness groups={[]} />)
    await user.type(field(), 'zz')
    expect(field()).toHaveAttribute('aria-expanded', 'false')
  })

  it('marks itself busy and invalid through attributes', () => {
    render(<Harness busy error="Choose what this links to." />)
    expect(field()).toHaveAttribute('aria-busy', 'true')
    expect(field()).toBeInvalid()
    expect(field()).toHaveAccessibleDescription('Choose what this links to.')
  })

  it('has no accessibility violations, closed or open', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness description="A document, a collection or an address." />)
    await expectNoAccessibilityViolations(container)
    await user.type(field(), 's')
    await expectNoAccessibilityViolations(container)
  })

  describe('inline, in a toolbar', () => {
    it('names itself without a visible label, and keeps its popup shut on focus', async () => {
      const user = userEvent.setup()
      render(<Harness variant="inline" opens="on-request" value="" />)
      expect(screen.queryByText('Links to')).toHaveClass('sr-only')
      await user.click(field())
      expect(field()).toHaveAttribute('aria-expanded', 'false')
    })

    it('is a 24px target, and the 44px touch size on a coarse pointer', () => {
      render(<Harness variant="inline" opens="on-request" />)
      // jsdom does no layout, so the size is read from the utilities that set it.
      expect(field()).toHaveClass('h-6', 'pointer-coarse:h-11')
    })

    it('opens on Enter or Alt+ArrowDown, and still chooses with Enter', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn<(id: string) => void>()
      render(<Harness variant="inline" opens="on-request" onSelect={onSelect} />)
      field().focus()
      await user.keyboard('{Enter}')
      expect(field()).toHaveAttribute('aria-expanded', 'true')
      await user.keyboard('{Enter}')
      expect(onSelect).toHaveBeenCalledWith('sync')

      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
      expect(field()).toHaveAttribute('aria-expanded', 'true')
    })

    it('selects what it shows on focus, so typing replaces it', async () => {
      const user = userEvent.setup()
      render(<Harness variant="inline" opens="on-request" />)
      await user.type(field(), 'Sync')
      await user.tab()
      await user.click(field())
      expect(field()).toHaveValue('Sync')
      const input = field()
      if (!(input instanceof HTMLInputElement)) throw new Error('The field is not an input.')
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4])
    })

    it('raises its popup above whatever clips the toolbar, where the browser can', async () => {
      const user = userEvent.setup()
      const shown = vi.fn<() => void>()
      const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover')
      Object.defineProperty(HTMLElement.prototype, 'showPopover', {
        configurable: true,
        value: shown,
      })
      onTestFinished(() => {
        if (original === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'showPopover')
        else Object.defineProperty(HTMLElement.prototype, 'showPopover', original)
      })
      render(<Harness variant="inline" opens="on-request" />)
      await user.type(field(), 's')
      expect(shown).toHaveBeenCalledTimes(1)
      // The stub opened nothing, so the popup reads as hidden to the test, as it would unopened.
      expect(screen.getByRole('listbox', { hidden: true }).parentElement).toHaveAttribute(
        'popover',
        'manual',
      )
    })

    it('has no accessibility violations, closed or open', async () => {
      const user = userEvent.setup()
      const { container } = render(<Harness variant="inline" opens="on-request" />)
      await expectNoAccessibilityViolations(container)
      await user.type(field(), 's')
      await expectNoAccessibilityViolations(container)
    })
  })
})
