import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

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

/** Selects the first occurrence of `text`, or puts the caret `offset` characters into it. */
function select(opened: Opened, text: string, offset?: number): void {
  const editor = editorOf(opened)
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text?.indexOf(text) ?? -1) : -1
    if (from < 0 && at >= 0) from = pos + at
  })
  if (from < 0) throw new Error(`"${text}" is not in the document.`)
  act(() => {
    editor.view.focus()
    editor
      .chain()
      .setTextSelection(
        offset === undefined ? { from, to: from + text.length } : from + offset,
      )
      .run()
  })
}

const toolbar = (name = 'Text formatting'): HTMLElement => screen.getByRole('toolbar', { name })
const choices = () => screen.getByRole('radiogroup', { name: 'Show link as' })
const choice = (name: string) => within(choices()).getByRole('radio', { name })

async function openBox(opened: Opened, toolbarName = 'Text formatting') {
  await opened.user.click(within(toolbar(toolbarName)).getByRole('button', { name: 'Link…' }))
}

describe('the link box offers how the link is shown', () => {
  it('as one choice, with a plain link chosen for words that are not a link yet', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await openBox(opened)

    expect(
      within(choices())
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-label') ?? (radio as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual(['Link', 'Inline', 'Compact', 'Card'])
    expect(choice('Link')).toBeChecked()
    await expectNoAccessibilityViolations(opened.container)
  })

  it('links the words and shows the link inline in one step', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await openBox(opened)
    await opened.user.keyboard('example.com')
    await opened.user.click(choice('Inline'))
    await opened.user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(markdown(opened)).toBe(
      'Say :link[something]{url="https://example.com" display="inline"} clever.\n',
    )
    expect(screen.queryByRole('textbox', { name: 'Link address' })).not.toBeInTheDocument()
  })

  it('shows the words as a card on a line of its own', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await openBox(opened)
    await opened.user.keyboard('https://example.com/page')
    await opened.user.click(choice('Card'))
    await opened.user.click(screen.getByRole('button', { name: 'Apply' }))

    const written = markdown(opened)
    expect(written).toContain('::link[something]{url="https://example.com/page" display="card"}')
    expect(written).toContain('Say')
    expect(written).toContain('clever.')
  })

  it('is one undo step, back to the words as they were', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await openBox(opened)
    await opened.user.keyboard('example.com')
    await opened.user.click(choice('Inline'))
    await opened.user.click(screen.getByRole('button', { name: 'Apply' }))

    editorOf(opened).view.focus()
    await opened.user.keyboard('{Control>}z{/Control}')

    expect(markdown(opened)).toBe('Say something clever.\n')
  })

  it('is operable from the keyboard alone: Tab to the choice, an arrow to change it, Tab to Apply', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await opened.user.keyboard('{Control>}k{/Control}')
    await opened.user.keyboard('example.com')
    await opened.user.tab()
    expect(choice('Link')).toHaveFocus()
    await opened.user.keyboard('{ArrowRight}')
    expect(choice('Inline')).toBeChecked()
    await opened.user.tab()
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus()
    await opened.user.keyboard('{Enter}')

    expect(markdown(opened)).toContain(':link[something]{url="https://example.com" display="inline"}')
  })

  it('submits with Enter from the address, keeping the choice made', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await openBox(opened)
    await opened.user.click(choice('Inline'))
    await opened.user.type(screen.getByRole('textbox', { name: 'Link address' }), 'example.com{Enter}')

    expect(markdown(opened)).toContain(':link[something]{url="https://example.com" display="inline"}')
  })

  it('leaves a plain link plain when the choice is not touched', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await openBox(opened)
    await opened.user.keyboard('example.com{Enter}')
    expect(markdown(opened)).toBe('Say [something](https://example.com) clever.\n')
  })

  it('starts from the display the link already has, and changes only that', async () => {
    const opened = open('See :link[the post]{url="https://blog.example/post" display="inline"} now.\n')
    select(opened, 'the post', 3)
    await opened.user.keyboard('{Control>}k{/Control}')

    expect(choice('Inline')).toBeChecked()
    await opened.user.click(choice('Link'))
    await opened.user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(markdown(opened)).toBe('See [the post](https://blog.example/post) now.\n')
  })

  it('does not let the address of a link written as a directive be edited here', async () => {
    const opened = open('See :link[the post]{url="https://blog.example/post" display="inline"} now.\n')
    select(opened, 'the post', 3)
    await opened.user.keyboard('{Control>}k{/Control}')

    expect(screen.getByRole('textbox', { name: 'Link address' })).toHaveAttribute('readonly')
  })

  it('does not offer a card or compact where a line of its own is not possible, and says why', async () => {
    const opened = open('# A heading with words\n')
    select(opened, 'words')
    await openBox(opened)

    for (const name of ['Compact', 'Card']) {
      expect(choice(name)).toBeDisabled()
      expect(choice(name)).toHaveAccessibleDescription(/line of its own/u)
    }
    expect(choice('Inline')).toBeEnabled()
  })

  it('gives up on Escape from a choice, as from the rest of the box', async () => {
    const opened = open('Say something clever.\n')
    select(opened, 'something')
    await openBox(opened)
    choice('Link').focus()
    await opened.user.keyboard('{Escape}')

    expect(screen.queryByRole('radiogroup', { name: 'Show link as' })).not.toBeInTheDocument()
    expect(markdown(opened)).toBe('Say something clever.\n')
  })
})
