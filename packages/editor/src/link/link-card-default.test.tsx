import { parseDocument } from '@quill/markdown'
import type { LinkDisplay } from '@quill/markdown'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import type { LinkPreviewSource } from '../blocks/link-preview-context.tsx'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'

const ADDRESS = 'https://blog.example/post'

function open(defaultDisplay: LinkDisplay | undefined, markdown: string) {
  const ref = createRef<DocumentEditorHandle>()
  const source: LinkPreviewSource = {
    preview: () => null,
    request: () => undefined,
    imageUrl: () => '',
    defaultDisplay,
  }
  render(<DocumentEditor ast={parseDocument(markdown).ast} ref={ref} linkPreviews={source} />)
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  act(() => {
    editor.view.focus()
    editor.commands.setNodeSelection(0)
  })
  return { user: userEvent.setup(), ref }
}

const display = (name: string) =>
  within(
    within(screen.getByRole('group', { name: /^Link to / })).getByRole('group', {
      name: 'Show link as',
    }),
  ).getByRole('button', { name })

describe('the link card over a link whose author chose no display', () => {
  it('shows the organisation’s default as the one in force', () => {
    open('card', `::link{url="${ADDRESS}"}\n`)
    expect(display('Card')).toHaveAttribute('aria-pressed', 'true')
    expect(display('Inline')).toHaveAttribute('aria-pressed', 'false')
  })

  it('follows a different default', () => {
    open('compact', `::link{url="${ADDRESS}"}\n`)
    expect(display('Compact')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the product’s default until the application says what the organisation’s is', () => {
    open(undefined, `::link{url="${ADDRESS}"}\n`)
    expect(display('Inline')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows what the author chose, whatever the default', () => {
    open('card', `::link{url="${ADDRESS}" display=compact}\n`)
    expect(display('Compact')).toHaveAttribute('aria-pressed', 'true')
  })
})

const cardGroup = () =>
  within(screen.getByRole('group', { name: /^Link to / })).queryByRole('group', { name: 'Card' })

describe('the link card’s card controls', () => {
  it('are there for a card, whose layout, picture and words are the author’s to shape', () => {
    open(undefined, `::link{url="${ADDRESS}" display=card}\n`)
    expect(cardGroup()).not.toBeNull()
  })

  it('are left out for a compact link, which has none of them to shape', () => {
    open(undefined, `::link{url="${ADDRESS}" display=compact}\n`)
    expect(cardGroup()).toBeNull()
  })

  it('follow the organisation’s default for a link whose author chose nothing', () => {
    open('compact', `::link{url="${ADDRESS}"}\n`)
    expect(cardGroup()).toBeNull()
  })
})
