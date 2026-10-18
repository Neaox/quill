import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextSelection } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

/**
 * How a link is shown, changed from the link card under it (ADR-042): the one
 * in force pressed, every other one press away, and a card's own layout,
 * picture and words beside them.
 */

function open(source: string) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  return { ref, user: userEvent.setup(), ...result }
}

type Opened = ReturnType<typeof open>

function editorOf(opened: Opened) {
  const editor = opened.ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  return editor
}

function markdown(opened: Opened): string {
  const handle = opened.ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

/** Puts the caret `offset` characters into the first occurrence of `text`. */
function caretIn(opened: Opened, text: string, offset: number): void {
  const editor = editorOf(opened)
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text?.indexOf(text) ?? -1) : -1
    if (from < 0 && at >= 0) from = pos + at
  })
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from + offset)),
    )
    editor.view.focus()
  })
}

/** Selects the card as a block, which is what pressing it does. */
function selectCard(opened: Opened): void {
  const editor = editorOf(opened)
  act(() => {
    editor.view.focus()
    editor.commands.setNodeSelection(0)
  })
}

const card = () => screen.getByRole('group', { name: /^Link to / })
const display = (name: string) =>
  within(within(card()).getByRole('group', { name: 'Show link as' })).getByRole('button', { name })

describe('how a link is shown, from its link card', () => {
  const source = 'Read [the docs](https://example.com/guide) now.\n'

  it('offers every way to show a link, with the one in force pressed', async () => {
    const opened = open(source)
    caretIn(opened, 'the docs', 3)
    const group = within(card()).getByRole('group', { name: 'Show link as' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Link', 'Inline', 'Compact', 'Card', 'Embed'])
    expect(display('Link')).toHaveAttribute('aria-pressed', 'true')
    expect(display('Card')).toHaveAttribute('aria-pressed', 'false')
    await expectNoAccessibilityViolations(opened.container)
  })

  it('shows the link inline when asked, and back as the plain link in one more press', async () => {
    const opened = open(source)
    caretIn(opened, 'the docs', 3)
    await opened.user.click(display('Inline'))
    expect(markdown(opened)).toBe(
      'Read [the docs](https://example.com/guide)<!-- quill:link display=inline --> now.\n',
    )
    expect(display('Inline')).toHaveAttribute('aria-pressed', 'true')
    await opened.user.click(display('Link'))
    expect(markdown(opened)).toBe('Read [the docs](https://example.com/guide) now.\n')
  })

  it('shows it as a card, whose choices then appear beside the display', async () => {
    const opened = open(source)
    caretIn(opened, 'the docs', 3)
    await opened.user.click(display('Card'))
    const choices = within(card()).getByRole('group', { name: 'Card' })
    await opened.user.click(within(choices).getByRole('button', { name: 'Image above' }))
    expect(markdown(opened)).toContain('layout=top')
    await opened.user.click(
      within(within(card()).getByRole('group', { name: 'Card' })).getByRole('button', {
        name: 'Image',
      }),
    )
    expect(markdown(opened)).toContain('image=none')
  })

  it('cannot show a link in a heading as a card, and says why', async () => {
    const opened = open('# Read [the docs](https://example.com/guide)\n')
    caretIn(opened, 'the docs', 3)
    expect(display('Card')).toHaveAttribute('aria-disabled', 'true')
    expect(display('Card')).toHaveAttribute('title', expect.stringMatching(/line of its own/u))
    await opened.user.click(display('Card'))
    expect(markdown(opened)).toBe('# Read [the docs](https://example.com/guide)\n')
  })

  it('keeps Unlink to an ordinary link, which a link with a display is turned back into first', async () => {
    const opened = open(source)
    caretIn(opened, 'the docs', 3)
    expect(within(card()).getByRole('button', { name: 'Unlink' })).toBeInTheDocument()
    await opened.user.click(display('Inline'))
    expect(within(card()).queryByRole('button', { name: 'Unlink' })).toBeNull()
  })

  describe('a card', () => {
    const cardSource = '<https://example.com/guide> <!-- quill:link display=card -->\n'
    const details = () =>
      within(within(card()).getByRole('group', { name: 'Card' })).getByRole('button', {
        name: 'Preview details…',
      })

    it('has its own title and description typed in, the page’s words shown as placeholders', async () => {
      const opened = open(cardSource)
      selectCard(opened)
      await opened.user.click(details())
      const title = await screen.findByRole('textbox', { name: 'Card title' })
      expect(title).toHaveFocus()
      await opened.user.type(title, 'Our take')
      await opened.user.type(
        screen.getByRole('textbox', { name: 'Card description' }),
        'Why it matters',
      )
      await opened.user.click(screen.getByRole('button', { name: 'Apply' }))
      expect(markdown(opened)).toContain('title="Our take"')
      expect(markdown(opened)).toContain('description="Why it matters"')
      expect(screen.queryByRole('textbox', { name: 'Card title' })).toBeNull()
    })

    it('hides the description when asked, which is not the same as leaving it empty', async () => {
      const opened = open(cardSource)
      selectCard(opened)
      await opened.user.click(details())
      await opened.user.click(await screen.findByRole('checkbox', { name: 'No description' }))
      await opened.user.click(screen.getByRole('button', { name: 'Apply' }))
      expect(markdown(opened)).toMatch(/description[ }]/u)
    })

    it('goes back to what the page says in one press, and gives up on Escape', async () => {
      const opened = open(
        '<https://example.com/guide> <!-- quill:link display=card title=Mine description="Mine too" -->\n',
      )
      selectCard(opened)
      await opened.user.click(details())
      await screen.findByRole('textbox', { name: 'Card title' })
      await opened.user.keyboard('{Escape}')
      expect(screen.queryByRole('textbox', { name: 'Card title' })).toBeNull()
      expect(markdown(opened)).toContain('title=Mine')
      selectCard(opened)
      await opened.user.click(details())
      await opened.user.click(await screen.findByRole('button', { name: 'Reset to fetched' }))
      expect(markdown(opened)).not.toContain('title=')
      expect(markdown(opened)).not.toContain('description')
    })

    it('opens its details from the link popover too, for the keyboard', async () => {
      const opened = open(cardSource)
      selectCard(opened)
      await opened.user.keyboard('{Control>}k{/Control}')
      const box = await screen.findByRole('dialog', { name: 'Edit link' })
      await opened.user.click(within(box).getByRole('button', { name: 'Preview details…' }))
      expect(await screen.findByRole('textbox', { name: 'Card title' })).toBeInTheDocument()
    })
  })
})
