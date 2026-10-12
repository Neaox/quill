import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ActionGroup, EditorAction } from '../actions/editor-action.ts'
import { MARK_GROUP } from '../actions/text-actions.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { ActionMenu } from './action-menu.tsx'

const harness = createEditorTestHarness()

function stateAt(markdown: string, from: number, to = from): EditorState {
  const opened = harness.state(markdown)
  return opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, from, to)))
}

const ALWAYS: EditorAction['command'] = () => true
const NEVER: EditorAction['command'] = () => false

const GROUPS: readonly ActionGroup[] = [
  {
    id: 'one',
    label: 'First group',
    actions: [
      { id: 'plain', label: 'Plain', command: ALWAYS },
      { id: 'keyed', label: 'Keyed', keys: 'Mod-k', description: 'Has a key', command: ALWAYS },
      { id: 'danger', label: 'Danger', destructive: true, command: ALWAYS },
      { id: 'off', label: 'Unavailable', command: NEVER },
    ],
  },
  {
    id: 'two',
    label: 'Second group',
    actions: [
      {
        id: 'tone',
        label: 'Toned',
        tone: 'warning',
        kind: 'radio',
        command: ALWAYS,
        isChecked: () => true,
      },
      { id: 'tick', label: 'Ticked', kind: 'check', command: ALWAYS, isChecked: () => true },
      { id: 'blank', label: 'Blank', kind: 'check', command: ALWAYS, isChecked: () => false },
    ],
  },
]

function open(groups: readonly ActionGroup[] = GROUPS, state = stateAt('Some text.\n', 1)) {
  const onChoose = vi.fn<(action: EditorAction) => void>()
  const onClose = vi.fn<(reason: string) => void>()
  const result = render(
    <ActionMenu
      label="Things"
      groups={groups}
      state={state}
      locate={() => ({ top: 10, right: 10, bottom: 10, left: 10 })}
      onChoose={onChoose}
      onClose={onClose}
    />,
  )
  return { onChoose, onClose, user: userEvent.setup(), ...result }
}

describe('the action menu', () => {
  it('is a menu named for what it is, with its groups named and its items in them', () => {
    open()
    const menu = screen.getByRole('menu', { name: 'Things' })
    expect(menu).toHaveFocus()
    expect(
      within(menu)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-labelledby')),
    ).toHaveLength(2)
    expect(within(menu).getByRole('group', { name: 'First group' })).toBeVisible()
    expect(within(menu).getByRole('group', { name: 'Second group' })).toBeVisible()
  })

  it('names an item by its label alone, with the description and key described apart from it', () => {
    open()
    const keyed = screen.getByRole('menuitem', { name: 'Keyed' })
    expect(keyed).toHaveAccessibleDescription('Has a key')
    expect(keyed).toHaveAttribute('aria-keyshortcuts', 'Mod-k')
  })

  it('sets a label above its description: heavier and larger, which is quieter and muted', () => {
    open()
    const keyed = screen.getByRole('menuitem', { name: 'Keyed' })
    const plain = screen.getByRole('menuitem', { name: 'Plain' })

    const label = within(keyed).getByText('Keyed')
    const description = within(keyed).getByText('Has a key')
    expect(label).toHaveClass('font-medium')
    expect(description).toHaveClass('text-2xs', 'text-muted')
    // A line of text on its own has nothing to be set apart from.
    expect(within(plain).getByText('Plain')).not.toHaveClass('font-medium')
  })

  it('draws the key it is bound to as a small key cap, not as a second line of text', () => {
    open()

    expect(screen.getByText(/Ctrl\+K|⌘K/)).toHaveClass('text-2xs', 'text-muted')
  })

  it('opens on the choice in force, so the keys go from there', () => {
    open([GROUPS[1] as ActionGroup])

    expect(screen.getByRole('menu')).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('menuitemradio', { name: 'Toned' }).id,
    )
  })

  it('opens on the first item when nothing is in force', () => {
    open([GROUPS[0] as ActionGroup])

    expect(screen.getByRole('menu')).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('menuitem', { name: 'Plain' }).id,
    )
  })

  it('marks what cannot be done as disabled, not as absent', () => {
    open()
    expect(screen.getByRole('menuitem', { name: 'Unavailable' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('menuitem', { name: 'Plain' })).not.toHaveAttribute('aria-disabled')
  })

  it('shows a choice as selected, and a switch as on or off', () => {
    open()
    expect(screen.getByRole('menuitemradio', { name: 'Toned' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemcheckbox', { name: 'Ticked' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemcheckbox', { name: 'Blank' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('menuitemcheckbox', { name: 'Ticked' })).toHaveTextContent('✓')
    expect(screen.getByRole('menuitemradio', { name: 'Toned' })).toHaveTextContent('●')
  })

  it('shows the key a switch is bound to, as the platform writes it', () => {
    open([MARK_GROUP])
    expect(
      within(screen.getByRole('menuitemcheckbox', { name: 'Bold' })).getByText(/^(Ctrl\+B|⌘B)$/),
    ).toBeVisible()
  })

  it('is accessible', async () => {
    const { container } = open()
    await expectNoAccessibilityViolations(container)
  })

  it('hands a chosen item to its caller and then says it is done', async () => {
    const { user, onChoose, onClose } = open()
    await user.click(screen.getByRole('menuitem', { name: 'Plain' }))
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'plain' }))
    expect(onClose).toHaveBeenCalledWith('chosen')
  })

  it('does neither for an item that is disabled, and stays open', async () => {
    const { user, onChoose, onClose } = open()
    await user.click(screen.getByRole('menuitem', { name: 'Unavailable' }))
    expect(onChoose).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('follows the pointer and the arrows with the same highlight', async () => {
    const { user } = open()
    const keyed = screen.getByRole('menuitem', { name: 'Keyed' })
    await user.hover(keyed)
    expect(keyed).toHaveAttribute('data-active')
    expect(screen.getByRole('menu')).toHaveAttribute('aria-activedescendant', keyed.id)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Danger' })).toHaveAttribute('data-active')
  })

  it('keeps the active item in view as the arrows move', async () => {
    const { user } = open()
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    await user.keyboard('{End}')
    expect(scrolled.mock.contexts.at(-1)).toBe(
      screen.getByRole('menuitemcheckbox', { name: 'Blank' }),
    )
    scrolled.mockRestore()
  })

  it('reports Escape and Tab as leaving, and a click elsewhere as that', async () => {
    const first = open()
    await first.user.keyboard('{Escape}')
    expect(first.onClose).toHaveBeenLastCalledWith('escape')
    await first.user.keyboard('{Tab}')
    expect(first.onClose).toHaveBeenLastCalledWith('escape')
    await first.user.click(document.body)
    expect(first.onClose).toHaveBeenLastCalledWith('outside')
  })

  it('leaves a key it has no use for to whatever else wants it', () => {
    open()
    const unhandled = screen
      .getByRole('menu')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }))
    expect(unhandled).toBe(true)
  })

  it('treats a press on the control that opened it as that control’s own', async () => {
    const onClose = vi.fn<(reason: string) => void>()
    const trigger = document.createElement('button')
    document.body.append(trigger)
    render(
      <ActionMenu
        label="Things"
        groups={GROUPS}
        state={stateAt('Some text.\n', 1)}
        locate={() => ({ top: 10, right: 10, bottom: 10, left: 10 })}
        trigger={trigger}
        onChoose={() => {}}
        onClose={onClose}
      />,
    )
    await userEvent.click(trigger)
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(document.body)
    expect(onClose).toHaveBeenCalledWith('outside')
    trigger.remove()
  })

  it('is not closed by a click on itself', async () => {
    const { user, onClose } = open()
    await user.click(screen.getByRole('group', { name: 'First group' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('has nothing to point at when it has nothing in it', () => {
    open([])
    expect(screen.getByRole('menu', { name: 'Things' })).not.toHaveAttribute(
      'aria-activedescendant',
    )
    expect(screen.queryAllByRole('menuitem')).toEqual([])
  })

  it('does not offer the browser’s own menu over itself', () => {
    open()
    const prevented = !screen
      .getByRole('menu')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(prevented).toBe(true)
  })
})
