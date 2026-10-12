import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'

/**
 * Backspace in the editor: an emoji goes whole, and a held key stops at the edge of a block.
 */

const NL = String.fromCharCode(10)

async function openAt(source: string, caretAt: number | readonly [number, number] | 'end') {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const user = userEvent.setup()
  const surface = screen.getByRole('textbox', { name: 'Document' })
  await user.click(surface)
  act(() => {
    const editor = ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('No editor.')
    if (caretAt === 'end') editor.commands.focus('end')
    else if (typeof caretAt === 'number') editor.commands.setTextSelection(caretAt)
    else editor.commands.setTextSelection({ from: caretAt[0], to: caretAt[1] })
  })
  const written = () => {
    const handle = ref.current
    if (handle === null) throw new Error('No editor.')
    return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  }
  return { user, surface, written, ref }
}

describe('Backspace after an emoji', () => {
  it('takes the whole emoji, which is one thing to the eye', async () => {
    const { user, surface, ref } = await openAt('Ship it :tada:', 'end')
    // Drawn once GitHub's list has loaded, which is its own chunk.
    await waitFor(() => {
      expect(surface.querySelector('.emoji')).not.toBeNull()
    })

    await user.keyboard('{Backspace}')

    // The space before it stays, as it would after a typed word.
    expect(ref.current?.editor?.getText()).toBe('Ship it ')
  })

  it('takes one character where the caret is inside the shortcode, which is then shown as text', async () => {
    const { user, written } = await openAt('Ship it :tada:', 12)

    await user.keyboard('{Backspace}')

    expect(written()).toBe('Ship it :tda:' + NL)
  })

  it('leaves a colon that ends no emoji to the ordinary key', async () => {
    const { user, written } = await openAt('Ship it :nope:', 'end')

    await user.keyboard('{Backspace}')

    expect(written()).toBe('Ship it \\:nope' + NL)
  })
})

const held = (surface: HTMLElement) =>
  fireEvent.keyDown(surface, { key: 'Backspace', repeat: true })

describe('holding Backspace', () => {
  it('stops at the start of a block, so it does not go on to eat the block before', async () => {
    const { surface, written } = await openAt('Before.' + NL + NL + 'Now', 10)

    expect(held(surface)).toBe(false)
    expect(written()).toBe('Before.' + NL + NL + 'Now' + NL)
  })

  it('goes on through the text of a block, which is what holding it is for', async () => {
    const { surface } = await openAt('Before.' + NL + NL + 'Now', 'end')

    expect(held(surface)).toBe(true)
  })

  it('lets the first press at the start of a block join it to the one before, as ever', async () => {
    const { user, written } = await openAt('Before.' + NL + NL + 'Now', 10)

    await user.keyboard('{Backspace}')

    expect(written()).toBe('Before.Now' + NL)
  })

  it('stops a held Delete at the end of a block in the same way', async () => {
    const { surface, written } = await openAt('Before.' + NL + NL + 'Now', 8)

    fireEvent.keyDown(surface, { key: 'Delete', repeat: true })

    expect(written()).toBe('Before.' + NL + NL + 'Now' + NL)
  })

  it('leaves other held keys alone', async () => {
    const { surface } = await openAt('Before.' + NL + NL + 'Now', 10)

    expect(fireEvent.keyDown(surface, { key: 'ArrowLeft', repeat: true })).toBe(true)
  })

  it('leaves a held key over a selection alone, which it deletes', async () => {
    const { surface, written } = await openAt('Before.' + NL + NL + 'Now', [1, 4])

    held(surface)

    expect(written()).toBe('ore.' + NL + NL + 'Now' + NL)
  })
})
