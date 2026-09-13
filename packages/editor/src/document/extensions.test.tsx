import { parseDocument, serializeDocument } from '@quill/markdown'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { createSlashStore } from '../slash/slash-store.ts'
import { SLASH_ITEMS } from '../slash/slash-items.ts'
import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'
import { buildExtensions } from './extensions.ts'

function names(extensions: ReturnType<typeof buildExtensions>): readonly string[] {
  return extensions.map((extension) => extension.name)
}

function markdown(ref: { current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

/** A paste of plain text, as a browser delivers one. */
function pasteText(target: HTMLElement, text: string, html = ''): void {
  const data = new DataTransfer()
  data.setData('text/plain', text)
  if (html.length > 0) data.setData('text/html', html)
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
}

describe('the assembled extension list', () => {
  it('is the published schema plus behaviour, and never a node of its own', () => {
    const assembled = names(buildExtensions())
    expect(assembled).toContain('paragraph')
    expect(assembled).toContain('containerDirective')
    expect(assembled).toContain('keyboardShortcuts')
    expect(assembled).toContain('markdownPaste')
    expect(assembled).toContain('placeholderTyping')
    expect(assembled).toContain('requiredSections')
    expect(assembled).toContain('guidanceDismissal')
  })

  it('has no slash menu unless one is asked for', () => {
    expect(names(buildExtensions())).not.toContain('slashMenu')
    const withMenu = buildExtensions({
      slash: { store: createSlashStore(), items: SLASH_ITEMS, run: () => {} },
    })
    expect(names(withMenu)).toContain('slashMenu')
  })

  it('takes the placeholder text it is given', () => {
    render(<DocumentEditor ast={parseDocument('\n').ast} placeholder="Say something" />)
    expect(document.querySelector('[data-placeholder="Say something"]')).not.toBeNull()
  })
})

describe('pasting into the editor', () => {
  it('reads plain text as Markdown', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument('Start.\n').ast} ref={ref} />)
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')
    editor.commands.setTextSelection(7)
    pasteText(screen.getByRole('textbox', { name: 'Document' }), '## A pasted heading\n')
    expect(markdown(ref)).toContain('## A pasted heading')
  })

  it('leaves rich content to ProseMirror', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument('Start.\n').ast} ref={ref} />)
    pasteText(screen.getByRole('textbox', { name: 'Document' }), '## Not read', '<p>Not read</p>')
    expect(markdown(ref)).not.toContain('## Not read')
  })

  it('has nothing to do with an empty clipboard', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument('Start.\n').ast} ref={ref} />)
    const surface = screen.getByRole('textbox', { name: 'Document' })
    surface.dispatchEvent(new ClipboardEvent('paste', { bubbles: true }))
    expect(markdown(ref)).toBe('Start.\n')
  })

  it('turns a URL pasted over a selection into a link', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument('Read the guide.\n').ast} ref={ref} />)
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')
    editor.commands.setTextSelection({ from: 10, to: 15 })
    pasteText(screen.getByRole('textbox', { name: 'Document' }), 'https://example.com/guide')
    expect(markdown(ref)).toContain('[guide](https://example.com/guide)')
  })
})

describe('the editor options that may be left out', () => {
  it('opens with a collapsed soft wrap when asked, and its own slash catalogue', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(
      <DocumentEditor
        ast={parseDocument('One line\nwrapped in two.\n').ast}
        ref={ref}
        softBreaks="collapse"
        slashItems={SLASH_ITEMS.slice(0, 1)}
        label="A named document"
        className="extra"
      />,
    )
    expect(markdown(ref)).toBe('One line wrapped in two.\n')
    expect(screen.getByRole('textbox', { name: 'A named document' })).toBeVisible()
  })

  it('can be opened read-only', () => {
    render(<DocumentEditor ast={parseDocument('Read me.\n').ast} editable={false} />)
    expect(screen.getByRole('textbox', { name: 'Document' })).toHaveAttribute(
      'contenteditable',
      'false',
    )
  })
})
