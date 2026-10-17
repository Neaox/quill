import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import type { LinkPreviewSource } from '../blocks/link-preview-context.tsx'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

const ADDRESS = 'https://blog.example/post'

const preview = (embed?: { provider: string; aspectRatio: number }): LinkPreviewSource => ({
  preview: () => ({
    title: 'A talk',
    description: null,
    siteName: null,
    thumbnail: null,
    favicon: null,
    ...(embed === undefined ? {} : { embed }),
  }),
  request: () => undefined,
  imageUrl: () => '',
})

function open(source: string, linkPreviews?: LinkPreviewSource) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(
    <DocumentEditor
      ast={parseDocument(source).ast}
      ref={ref}
      {...(linkPreviews === undefined ? {} : { linkPreviews })}
    />,
  )
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

/** Pastes `text` at the end of the document, as a browser would. */
function pasteAtEnd(opened: Opened, text: string): void {
  const editor = editorOf(opened)
  act(() => {
    editor.view.focus()
    editor
      .chain()
      .setTextSelection(editor.state.doc.content.size - 1)
      .run()
  })
  const clipboardData = new DataTransfer()
  clipboardData.setData('text/plain', text)
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
  act(() => {
    editor.view.dom.dispatchEvent(event)
  })
}

const offer = () => screen.getByRole('group', { name: 'Show pasted link as' })

describe('the offer that follows a pasted address', () => {
  it('appears beside the link, which is already in the document', async () => {
    const opened = open('See')
    pasteAtEnd(opened, ADDRESS)
    expect(markdown(opened)).toContain(`<${ADDRESS}>`)
    const choices = within(offer()).getAllByRole('button')
    expect(choices.map((button) => button.textContent)).toEqual([
      'Link',
      'Inline',
      'Compact',
      'Card',
      'Embed',
    ])
    expect(choices[0]).toHaveAttribute('aria-pressed', 'true')
    await expectNoAccessibilityViolations(opened.container)
  })

  it('shows the link inline when asked, and is then gone', async () => {
    const opened = open('See')
    pasteAtEnd(opened, ADDRESS)
    await opened.user.click(within(offer()).getByRole('button', { name: 'Inline' }))
    expect(markdown(opened)).toContain(`:link[${ADDRESS}]{display="inline"}`)
    expect(screen.queryByRole('group', { name: 'Show pasted link as' })).toBeNull()
  })

  it('shows the link as a card on a line of its own', async () => {
    const opened = open('See')
    pasteAtEnd(opened, ADDRESS)
    await opened.user.click(within(offer()).getByRole('button', { name: 'Card' }))
    expect(markdown(opened)).toContain(`::link{url="${ADDRESS}" display="card"}`)
  })

  describe('Embed', () => {
    const embedButton = () => within(offer()).getByRole('button', { name: 'Embed' })

    it('is disabled, with the reason, for a page that cannot be embedded', () => {
      const opened = open('See', preview())
      pasteAtEnd(opened, ADDRESS)
      expect(embedButton()).toBeDisabled()
      expect(embedButton()).toHaveAttribute('title', expect.stringMatching(/cannot be embedded/u))
    })

    it('is offered for a page whose preview has a frame, and shows the link as an embed', async () => {
      const opened = open('See', preview({ provider: 'YouTube', aspectRatio: 16 / 9 }))
      pasteAtEnd(opened, ADDRESS)
      await waitFor(() => {
        expect(embedButton()).toBeEnabled()
      })
      await opened.user.click(embedButton())
      expect(markdown(opened)).toContain(`::link{url="${ADDRESS}" display="embed"}`)
    })
  })

  it('goes away when the author types on', () => {
    const opened = open('See')
    pasteAtEnd(opened, ADDRESS)
    act(() => {
      editorOf(opened).commands.insertContent(' and more')
    })
    expect(screen.queryByRole('group', { name: 'Show pasted link as' })).toBeNull()
  })

  it('is not offered for text that is not just an address', () => {
    const opened = open('See')
    pasteAtEnd(opened, `${ADDRESS} and more`)
    expect(screen.queryByRole('group', { name: 'Show pasted link as' })).toBeNull()
  })
})
