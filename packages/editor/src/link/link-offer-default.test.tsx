import { parseDocument, serializeDocument } from '@quill/markdown'
import type { LinkDisplay } from '@quill/markdown'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import type { LinkPreviewSource } from '../blocks/link-preview-context.tsx'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

const ADDRESS = 'https://blog.example/post'

function open(defaultDisplay: LinkDisplay | undefined) {
  const ref = createRef<DocumentEditorHandle>()
  const source: LinkPreviewSource = {
    preview: () => null,
    request: () => undefined,
    imageUrl: () => '',
    defaultDisplay,
  }
  const result = render(
    <DocumentEditor ast={parseDocument('See').ast} ref={ref} linkPreviews={source} />,
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

describe('the organisation’s default display in the paste offer', () => {
  it('points at the choice the organisation made the default, and describes it', async () => {
    const opened = open('card')
    pasteAtEnd(opened, ADDRESS)
    const card = within(offer()).getByRole('button', { name: 'Card' })
    expect(card).toHaveAccessibleDescription('Your organisation’s default')
    expect(card).toHaveAttribute('data-suggested')
    for (const other of ['Link', 'Inline', 'Compact']) {
      expect(within(offer()).getByRole('button', { name: other })).not.toHaveAttribute(
        'data-suggested',
      )
    }
    await expectNoAccessibilityViolations(opened.container)
  })

  it('still leaves the pasted link plain until the author picks', () => {
    const opened = open('card')
    pasteAtEnd(opened, ADDRESS)
    expect(markdown(opened)).toContain(`<${ADDRESS}>`)
    expect(within(offer()).getByRole('button', { name: 'Link' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('points at nothing when the application has no default to give', () => {
    const opened = open(undefined)
    pasteAtEnd(opened, ADDRESS)
    expect(offer().querySelector('[data-suggested]')).toBeNull()
  })

  it('takes the suggested choice as any other, with a click', async () => {
    const opened = open('inline')
    pasteAtEnd(opened, ADDRESS)
    await opened.user.click(within(offer()).getByRole('button', { name: 'Inline' }))
    expect(markdown(opened)).toContain(`<${ADDRESS}><!-- quill:link display=inline -->`)
  })
})
