import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { ContextMenu } from './context-menu.tsx'
import type { ContextMenuProps, ContextMenuSection } from './context-menu.tsx'

const ANCHOR = { x: 120, y: 80, width: 0, height: 0 }

function sections(spy: (what: string) => void = () => {}): readonly ContextMenuSection[] {
  return [
    {
      id: 'clipboard',
      entries: [
        {
          kind: 'action',
          id: 'copy',
          label: 'Copy',
          shortcut: 'Ctrl+C',
          onSelect: () => spy('copy'),
        },
        {
          kind: 'action',
          id: 'paste',
          label: 'Paste',
          disabledReason: 'The browser keeps the clipboard to itself here',
          onSelect: () => spy('paste'),
        },
      ],
    },
    { id: 'empty', entries: [] },
    {
      id: 'block',
      label: 'Block',
      entries: [
        {
          kind: 'submenu',
          id: 'turn-into',
          label: 'Turn into',
          entries: [
            { kind: 'action', id: 'h2', label: 'Heading 2', onSelect: () => spy('h2') },
            {
              kind: 'choice',
              id: 'tone',
              label: 'Tone',
              value: 'note',
              options: [
                { value: 'note', label: 'Note' },
                { value: 'info', label: 'Info', disabledReason: 'Not for an alert' },
              ],
              onValueChange: (value) => spy(`tone:${value}`),
            },
          ],
        },
        {
          kind: 'choice',
          id: 'type',
          label: 'Type',
          value: 'tip',
          options: [
            { value: 'tip', label: 'Tip' },
            { value: 'warning', label: 'Warning', icon: <svg data-testid="warning-icon" /> },
          ],
          onValueChange: (value) => spy(`type:${value}`),
        },
        {
          kind: 'action',
          id: 'freeze',
          label: 'Freeze header',
          checked: true,
          onSelect: () => spy('freeze'),
        },
        {
          kind: 'action',
          id: 'delete',
          label: 'Delete',
          tone: 'danger',
          onSelect: () => spy('delete'),
        },
      ],
    },
  ]
}

function Harness(props: Partial<ContextMenuProps> & { readonly spy?: (what: string) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button">Where focus was</button>
      <ContextMenu
        open={open}
        label="Text"
        anchor={ANCHOR}
        sections={sections(props.spy)}
        onOpenChange={setOpen}
        {...props}
      />
    </>
  )
}

describe('ContextMenu', () => {
  it('opens at its anchor as a named menu, and passes axe', async () => {
    render(<Harness />)
    const menu = await screen.findByRole('menu', { name: 'Text' })
    expect(menu).toHaveAttribute('data-presentation', 'menu')
    expect(screen.getByRole('menuitem', { name: /Copy/ })).toBeInTheDocument()
    expect(screen.getByText('Ctrl+C').tagName).toBe('KBD')
    // The panel is portalled; the page's landmarks are the application's.
    await expectNoAccessibilityViolations(menu)
  })

  it('says why an entry cannot be used, and does not run it', async () => {
    const spy = vi.fn<(what: string) => void>()
    render(<Harness spy={spy} />)
    const paste = await screen.findByRole('menuitem', { name: /Paste/ })
    expect(paste).toHaveAttribute('data-disabled')
    expect(paste).toHaveAccessibleDescription('The browser keeps the clipboard to itself here')
    await userEvent.click(paste)
    expect(spy).not.toHaveBeenCalled()
  })

  it('runs an entry and closes, returning focus where the caller says', async () => {
    const spy = vi.fn<(what: string) => void>()
    const focus = vi.fn<() => void>()
    render(<Harness spy={spy} onCloseFocus={focus} />)
    await userEvent.click(await screen.findByRole('menuitem', { name: /Copy/ }))
    expect(spy).toHaveBeenCalledWith('copy')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(focus).toHaveBeenCalled()
  })

  it('leaves focus to Radix when the caller has nowhere to send it', async () => {
    render(<Harness />)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens a submenu sideways, with its choices', async () => {
    const spy = vi.fn<(what: string) => void>()
    render(<Harness spy={spy} />)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Turn into' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Heading 2' }))
    expect(spy).toHaveBeenCalledWith('h2')
  })

  it('marks the chosen option and chooses another', async () => {
    const spy = vi.fn<(what: string) => void>()
    render(<Harness spy={spy} />)
    expect(await screen.findByRole('menuitemradio', { name: 'Tip' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    const warning = screen.getByRole('menuitemradio', { name: 'Warning' })
    expect(warning).toContainElement(screen.getByTestId('warning-icon'))
    await userEvent.click(warning)
    expect(spy).toHaveBeenCalledWith('type:warning')
  })

  it('is a sheet along the bottom on a phone, its submenus laid out in place', async () => {
    const spy = vi.fn<(what: string) => void>()
    render(<Harness spy={spy} presentation="sheet" />)
    const menu = await screen.findByRole('menu', { name: 'Text' })
    expect(menu).toHaveAttribute('data-presentation', 'sheet')
    expect(screen.getByRole('group', { name: 'Turn into' })).toBeInTheDocument()
    const info = screen.getByRole('menuitemradio', { name: /Info/ })
    expect(info).toHaveAttribute('data-disabled')
    await expectNoAccessibilityViolations(menu)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Note' }))
    expect(spy).toHaveBeenCalledWith('tone:note')
  })

  it('shows a setting as checked, and toggles it', async () => {
    const spy = vi.fn<(what: string) => void>()
    render(<Harness spy={spy} />)
    const freeze = await screen.findByRole('menuitemcheckbox', { name: 'Freeze header' })
    expect(freeze).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(freeze)
    expect(spy).toHaveBeenCalledWith('freeze')
  })

  it('draws nothing while closed', () => {
    render(<Harness open={false} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('ContextMenu on a phone', () => {
  it('leaves keyboard shortcuts out of a sheet, which is for a finger', async () => {
    render(<Harness presentation="sheet" />)
    await screen.findByRole('menu', { name: 'Text' })
    expect(screen.queryByText('Ctrl+C')).not.toBeInTheDocument()
  })
})
