import { parseDocument, serializeDocument } from '@quill/markdown'
import { NodeSelection } from '@tiptap/pm/state'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { BlockMenu } from './block-menu.tsx'
import type { CommentRequest } from './block-menu.tsx'

const DOCUMENT = ['First paragraph.', '', 'Second paragraph.', ''].join('\n')

function open(source = DOCUMENT) {
  const ref = createRef<DocumentEditorHandle>()
  const onComment = vi.fn<(request: CommentRequest) => void>()
  const result = render(
    <DocumentEditor ast={parseDocument(source).ast} ref={ref} onComment={onComment} />,
  )
  return { ref, onComment, user: userEvent.setup(), ...result }
}

function markdown(ref: { current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /options$/ })
}

async function openMenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(trigger())
  return screen.getByRole('menu')
}

describe('the block menu', () => {
  it('names the block it acts on', () => {
    open()
    expect(trigger()).toHaveAccessibleName('Paragraph options')
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('offers the three widths as a radio group, and the actions as items', async () => {
    const { user, container } = open()
    const menu = await openMenu(user)
    const widths = within(menu).getAllByRole('menuitemradio')
    expect(widths.map((item) => item.textContent)).toEqual(['Content', 'Wide', 'Full'])
    expect(widths[0]).toHaveAttribute('aria-checked', 'true')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Move up', 'Move down', 'Duplicate', 'Delete', 'Add comment'])
    expect(within(menu).getByRole('group', { name: 'Width' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('says which actions this block cannot do', async () => {
    const { user } = open()
    const menu = await openMenu(user)
    expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Move down' })).toBeEnabled()
  })

  it('moves through the items with the keyboard and chooses one with Enter', async () => {
    const { user, ref } = open()
    const menu = await openMenu(user)
    expect(menu).toHaveFocus()
    expect(menu).toHaveAttribute(
      'aria-activedescendant',
      within(menu).getAllByRole('menuitemradio')[0]?.id ?? '',
    )

    await user.keyboard('{ArrowDown}{Enter}')
    expect(markdown(ref)).toContain(':::wide')
  })

  it('wraps around the ends and jumps to either with Home and End', async () => {
    const { user } = open()
    const menu = await openMenu(user)
    const ids = [
      ...within(menu).getAllByRole('menuitemradio'),
      ...within(menu).getAllByRole('menuitem'),
    ].map((item) => item.id)

    await user.keyboard('{End}')
    expect(menu).toHaveAttribute('aria-activedescendant', ids.at(-1) ?? '')
    await user.keyboard('{ArrowDown}')
    expect(menu).toHaveAttribute('aria-activedescendant', ids[0] ?? '')
    await user.keyboard('{ArrowUp}')
    expect(menu).toHaveAttribute('aria-activedescendant', ids.at(-1) ?? '')
    await user.keyboard('{Home}')
    expect(menu).toHaveAttribute('aria-activedescendant', ids[0] ?? '')
  })

  it('closes on Escape and gives the trigger its focus back', async () => {
    const { user } = open()
    await openMenu(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('ignores a key it does not know', async () => {
    const { user } = open()
    const menu = await openMenu(user)
    await user.keyboard('q')
    expect(menu).toBeInTheDocument()
  })

  it('moves, duplicates and deletes the block it names', async () => {
    const { user, ref } = open()
    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
    expect(markdown(ref)).toBe('Second paragraph.\n\nFirst paragraph.\n')

    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(markdown(ref)).toContain('First paragraph.\n\nFirst paragraph.')

    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(markdown(ref)).toBe('Second paragraph.\n\nFirst paragraph.\n')
  })

  it('does nothing when a disabled item is clicked or chosen', async () => {
    const { user, ref } = open()
    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Move up' }))
    expect(markdown(ref)).toBe(DOCUMENT)

    // The same item, chosen with the keyboard rather than the pointer.
    await user.keyboard('{Home}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    expect(markdown(ref)).toBe(DOCUMENT)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('reports a comment on the block rather than making one', async () => {
    const { user, onComment } = open()
    await user.click(trigger())
    await user.click(screen.getByRole('menuitem', { name: 'Add comment' }))
    expect(onComment).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('First paragraph.') }),
    )
  })

  it('offers no comment when nobody is listening for one', async () => {
    render(<DocumentEditor ast={parseDocument(DOCUMENT).ast} />)
    const user = userEvent.setup()
    await user.click(trigger())
    expect(screen.getByRole('menuitem', { name: 'Add comment' })).toBeDisabled()
  })

  it('offers no width for a block that cannot carry one', async () => {
    const { user, ref } = open('---\ntitle: A\n---\n\nText.\n')
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)))
    })
    const menu = await openMenu(user)
    expect(within(menu).queryAllByRole('menuitemradio')).toEqual([])
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0)
  })

  it('shows nothing at all without an editor', () => {
    const { container } = render(<BlockMenu editor={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('follows the caret to another block', () => {
    const { ref } = open('# A heading\n\nA paragraph.\n')
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')
    expect(trigger()).toHaveAccessibleName('Heading options')
    act(() => {
      editor.commands.setTextSelection(16)
    })
    expect(trigger()).toHaveAccessibleName('Paragraph options')
  })
})
