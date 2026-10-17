import { parseDocument, serializeDocument } from '@quill/markdown'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { createSlashStore } from '../slash/slash-store.ts'
import { createSlashRecents } from '../slash/slash-recents.ts'
import { createSlashRegistry } from '../slash/slash-registry.ts'
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

/** Where an extension sits in TipTap's order; 100 is TipTap's default. */
function priority(extension: ReturnType<typeof buildExtensions>[number]): number {
  return extension.config.priority ?? 100
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
      slash: {
        store: createSlashStore(),
        registry: createSlashRegistry(),
        recents: createSlashRecents('test', null),
        request: () => {},
      },
    })
    expect(names(withMenu)).toContain('slashMenu')
    // Ahead of every keymap, so Enter chooses an item rather than splitting the line. The emoji
    // suggestion is the same menu's second trigger and stands where it does.
    const menus = new Set(['slashMenu', 'emojiSuggestion'])
    expect(names(withMenu)).toContain('emojiSuggestion')
    const others = withMenu.filter((extension) => !menus.has(extension.name)).map(priority)
    const ahead = withMenu.filter((extension) => menus.has(extension.name)).map(priority)
    expect(Math.min(...ahead)).toBeGreaterThan(Math.max(...others))
    expect(names(buildExtensions())).not.toContain('emojiSuggestion')
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
  it('opens with a collapsed soft wrap when asked', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(
      <DocumentEditor
        ast={parseDocument('One line\nwrapped in two.\n').ast}
        ref={ref}
        softBreaks="collapse"
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
