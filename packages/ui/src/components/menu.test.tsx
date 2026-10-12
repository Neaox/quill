import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Menu, MenuButton } from './menu.tsx'

const ITEMS = [
  { label: 'Rename…', onSelect: () => {} },
  { label: 'Move to…', onSelect: () => {} },
  { label: 'Delete…', onSelect: () => {} },
]

describe('Menu', () => {
  it('names the thing its actions act on, so three identical triggers are told apart', async () => {
    const { container } = render(<Menu label="Failover" items={ITEMS} />)

    const trigger = screen.getByRole('button', { name: 'More actions for Failover' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expectNoAccessibilityViolations(container)
  })

  it('renders nothing at all when it has no actions to offer', () => {
    render(<Menu label="Failover" items={[]} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('opens on click and lists every action as a menu item', async () => {
    render(<Menu label="Failover" items={ITEMS} />)

    const trigger = screen.getByRole('button', { name: 'More actions for Failover' })
    await userEvent.click(trigger)

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('leaves the page behind it usable, because a row menu is not a dialog', async () => {
    render(
      <>
        <button type="button">Something else</button>
        <Menu label="Failover" items={ITEMS} />
      </>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Failover' }))
    await screen.findByRole('menu')

    expect(screen.getByRole('button', { name: 'Something else' })).toBeInTheDocument()
    expect(document.body).not.toHaveAttribute('data-scroll-locked')
  })

  /*
   * The keyboard model both hand-rolled menus claimed with `role="menu"` and
   * never implemented (review 2026-09-13, M6): opening from the keyboard
   * focuses the first item, and the arrow keys move between them.
   */
  it('opens from the keyboard onto the first item, and moves with the arrow keys', async () => {
    render(<Menu label="Failover" items={ITEMS} />)

    screen.getByRole('button', { name: 'More actions for Failover' }).focus()
    await userEvent.keyboard('{Enter}')

    await screen.findByRole('menu')
    expect(screen.getByRole('menuitem', { name: 'Rename…' })).toHaveFocus()

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Move to…' })).toHaveFocus()

    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Rename…' })).toHaveFocus()
  })

  it('closes on Escape and gives focus back to the trigger', async () => {
    render(<Menu label="Failover" items={ITEMS} />)

    const trigger = screen.getByRole('button', { name: 'More actions for Failover' })
    await userEvent.click(trigger)
    await screen.findByRole('menu')

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('runs the action that was chosen, and closes', async () => {
    const onSelect = vi.fn<() => void>()
    render(<Menu label="Failover" items={[{ label: 'Delete…', onSelect }]} />)

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Failover' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('takes its own alignment and classes for a row that needs a different trigger', async () => {
    render(
      <Menu
        label="Guides"
        items={ITEMS}
        align="start"
        triggerClassName="size-5"
        className="min-w-56"
      />,
    )

    const trigger = screen.getByRole('button', { name: 'More actions for Guides' })
    expect(trigger).toHaveClass('size-5')

    await userEvent.click(trigger)
    expect(await screen.findByRole('menu')).toHaveClass('min-w-56')
  })

  it('marks a disabled action disabled rather than leaving it to swallow a press', async () => {
    const onSelect = vi.fn<() => void>()
    render(
      <Menu label="Failover" items={[{ label: 'Delete…', onSelect, disabled: true }]} />, //
    )

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Failover' }))
    const item = await screen.findByRole('menuitem', { name: 'Delete…' })

    expect(item).toHaveAttribute('data-disabled')
    await userEvent.click(item)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

function renderPersonMenu(
  onSignOut = vi.fn<() => void>(),
  onScheme = vi.fn<(value: string) => void>(),
) {
  const view = render(
    <MenuButton
      label="Account menu for Ada Writer"
      header={<span>ada@example.com</span>}
      sections={[
        {
          id: 'appearance',
          entries: [
            {
              kind: 'choice',
              label: 'Appearance',
              value: 'system',
              options: [
                { value: 'system', label: 'System' },
                { value: 'dark', label: 'Dark' },
              ],
              onValueChange: onScheme,
            },
          ],
        },
        {
          id: 'organisation',
          label: 'Organisation',
          entries: [{ kind: 'link', label: 'Theme', target: { to: '/admin/settings/theme' } }],
        },
        { id: 'empty', label: 'Nothing', entries: [] },
        { id: 'session', entries: [{ kind: 'action', label: 'Sign out', onSelect: onSignOut }] },
      ]}
    >
      <span>Ada Writer</span>
    </MenuButton>,
  )
  return { ...view, onSignOut, onScheme }
}

describe('MenuButton', () => {
  it('is a menu button named by the label, which contains the words it shows', async () => {
    const { container } = renderPersonMenu()

    const trigger = screen.getByRole('button', { name: 'Account menu for Ada Writer' })
    expect(trigger).toHaveTextContent('Ada Writer')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await expectNoAccessibilityViolations(container)
  })

  it('opens from the keyboard onto its first item and walks links, choices and actions', async () => {
    renderPersonMenu()

    screen.getByRole('button', { name: 'Account menu for Ada Writer' }).focus()
    await userEvent.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')

    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus()
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Theme' })).toHaveFocus()
    expect(screen.getByRole('menuitem', { name: 'Theme' })).toHaveAttribute(
      'href',
      '/admin/settings/theme',
    )
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus()
    expect(screen.getByRole('group', { name: 'Organisation' })).toBeInTheDocument()
    expect(screen.queryByText('Nothing')).not.toBeInTheDocument()
    await expectNoAccessibilityViolations(menu)
  })

  it('keeps the panel open on a choice and closes on an action', async () => {
    const { onSignOut, onScheme } = renderPersonMenu()

    await userEvent.click(screen.getByRole('button', { name: 'Account menu for Ada Writer' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))
    expect(onScheme).toHaveBeenCalledWith('dark')
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('MenuButton rows', () => {
  function renderRows(onCycle = vi.fn<() => void>()) {
    render(
      <MenuButton
        label="Account menu for Ada Writer"
        sections={[
          {
            id: 'person',
            entries: [
              {
                kind: 'link',
                label: 'Preferences',
                target: { to: '/preferences' },
                icon: <svg data-testid="prefs-icon" />,
              },
              {
                kind: 'action',
                label: 'Appearance',
                icon: <svg data-testid="scheme-icon" />,
                hint: 'System',
                keepOpen: true,
                onSelect: onCycle,
              },
            ],
          },
        ]}
      >
        <span>Ada Writer</span>
      </MenuButton>,
    )
    return onCycle
  }

  it('draws an icon before a row, which says nothing the words do not and is hidden from assistive technology', async () => {
    renderRows()

    await userEvent.click(screen.getByRole('button', { name: 'Account menu for Ada Writer' }))

    const item = await screen.findByRole('menuitem', { name: 'Preferences' })
    expect(item).toContainElement(screen.getByTestId('prefs-icon'))
    expect(screen.getByTestId('prefs-icon').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('says what a row is set to after its name, as a reader hears it: "Appearance: System"', async () => {
    renderRows()

    await userEvent.click(screen.getByRole('button', { name: 'Account menu for Ada Writer' }))

    expect(
      await screen.findByRole('menuitem', { name: /^Appearance:\s*System$/u }),
    ).toBeInTheDocument()
  })

  it('announces a change of the setting politely, since the row keeps the focus', async () => {
    renderRows()

    await userEvent.click(screen.getByRole('button', { name: 'Account menu for Ada Writer' }))
    const hint = (await screen.findByText('System')).closest('[aria-live]')

    expect(hint).toHaveAttribute('aria-live', 'polite')
  })

  it('keeps the panel open on a row that asks to, so it can be pressed again', async () => {
    const onCycle = renderRows()

    await userEvent.click(screen.getByRole('button', { name: 'Account menu for Ada Writer' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Appearance:\s*System$/u }))
    await userEvent.keyboard('{Enter}')

    expect(onCycle).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})
