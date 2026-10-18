import { parseDocument } from '@quill/markdown'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import { shortcutLabel } from '../format/shortcuts.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { SHORTCUT_GROUPS } from './shortcut-catalogue.ts'
import { ShortcutsDialog } from './shortcuts-dialog.tsx'

const dialog = () => screen.getByRole('dialog', { name: 'Keyboard shortcuts' })

describe('the keyboard shortcuts dialog', () => {
  it('lists each group under its heading, each shortcut with its keys drawn for this platform', () => {
    render(<ShortcutsDialog open onOpenChange={() => undefined} />)

    for (const group of SHORTCUT_GROUPS) {
      const section = within(dialog()).getByRole('region', { name: group.title })
      expect(within(section).getAllByRole('term')).toHaveLength(group.shortcuts.length)
    }
    const formatting = within(dialog()).getByRole('region', { name: 'Formatting' })
    expect(within(formatting).getByText('Bold').closest('div')).toHaveTextContent(
      shortcutLabel('Mod-b'),
    )
  })

  it('draws a key as a key, and several that do the same, one after another', () => {
    render(<ShortcutsDialog open onOpenChange={() => undefined} />)

    const redo = within(dialog()).getByText('Redo').closest('div')
    const keys = within(redo ?? dialog()).getAllByText(/.+/u, { selector: 'kbd' })

    expect(keys.map((kbd) => kbd.textContent)).toEqual([
      shortcutLabel('Mod-Shift-z'),
      shortcutLabel('Mod-y'),
    ])
  })

  it('shows a typed trigger as the character that is typed', () => {
    render(<ShortcutsDialog open onOpenChange={() => undefined} />)

    const emoji = within(dialog()).getByText('Insert an emoji').closest('div')

    expect(within(emoji ?? dialog()).getByText(':', { selector: 'kbd' })).toBeInTheDocument()
  })

  it('has nothing for an axe check to object to', async () => {
    render(<ShortcutsDialog open onOpenChange={() => undefined} />)

    await expectNoAccessibilityViolations(dialog())
  })

  it('asks to close on Escape', async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>()
    render(<ShortcutsDialog open onOpenChange={onOpenChange} />)

    await userEvent.setup().keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('opening it from the editor', () => {
  it('opens on Ctrl+/ anywhere in the document, and closes on Escape with the caret back in it', async () => {
    const user = userEvent.setup()
    render(<DocumentEditor ast={parseDocument('Some words.\n').ast} />)
    const surface = screen.getByRole('textbox', { name: 'Document' })
    await user.click(surface)

    await user.keyboard('{Control>}/{/Control}')
    expect(dialog()).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
    // Put back a frame later, which is when the editor focuses.
    await waitFor(() => {
      expect(surface).toHaveFocus()
    })
  })
})
