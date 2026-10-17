import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'

/**
 * Backspace just past a drawn emoji takes the whole emoji, in every browser: the editor's own key
 * handler does it, rather than each browser's idea of what one character behind a widget is.
 */

const NL = String.fromCharCode(10)

async function openAt(source: string, caretAt: number | 'end') {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const user = userEvent.setup()
  const surface = screen.getByRole('textbox', { name: 'Document' })
  await user.click(surface)
  act(() => {
    const editor = ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('No editor.')
    if (caretAt === 'end') editor.commands.focus('end')
    else editor.commands.setTextSelection(caretAt)
  })
  const written = () => {
    const handle = ref.current
    if (handle === null) throw new Error('No editor.')
    return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  }
  return { user, surface, written, ref }
}

describe('Backspace after an emoji (ADR-038)', () => {
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
