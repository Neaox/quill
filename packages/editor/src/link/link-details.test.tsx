import { parseDocument } from '@quill/markdown'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import type { LinkPreviewSource } from '../blocks/link-preview-context.tsx'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'

const ADDRESS = 'https://blog.example/post'

const source: LinkPreviewSource = {
  preview: () => ({
    title: 'How we cut build times',
    description: 'Caching and parallelism.',
    siteName: 'Engineering blog',
    thumbnail: null,
    favicon: null,
  }),
  request: () => undefined,
  imageUrl: () => '',
}

/** The link card is outside the card block, so it needs the preview from the same source the card has. */
describe('a card’s preview details', () => {
  it('shows what the page says as the placeholders for the author’s own words', async () => {
    const ref = createRef<DocumentEditorHandle>()
    render(
      <DocumentEditor
        ast={parseDocument(`::link{url="${ADDRESS}" display=card}\n`).ast}
        ref={ref}
        linkPreviews={source}
      />,
    )
    const editor = ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
    act(() => {
      editor.view.focus()
      editor.commands.setNodeSelection(0)
    })

    await userEvent.click(
      within(screen.getByRole('group', { name: /^Link to / })).getByRole('button', {
        name: 'Preview details…',
      }),
    )

    expect(screen.getByRole('textbox', { name: 'Card title' })).toHaveAttribute(
      'placeholder',
      'How we cut build times',
    )
    expect(screen.getByRole('textbox', { name: 'Card description' })).toHaveAttribute(
      'placeholder',
      'Caching and parallelism.',
    )
  })
})
