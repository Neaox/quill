import { Editor } from '@tiptap/react'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LinkPreviewProvider, NO_LINK_PREVIEWS } from '../blocks/link-preview-context.tsx'
import type { LinkPreviewSource } from '../blocks/link-preview-context.tsx'
import { buildExtensions } from '../document/extensions.ts'
import { LiveLinkTitles } from './live-link-titles.tsx'
import { liveTitleKey } from './live-titles.ts'

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function openEditor(): Editor {
  const editor = new Editor({
    extensions: buildExtensions({ files: { onFiles: () => undefined } }),
  })
  editors.push(editor)
  return editor
}

const another: LinkPreviewSource = { ...NO_LINK_PREVIEWS, preview: () => null }

describe('the live titles of an editor', () => {
  it('are installed while the editor is shown, and taken away with it', () => {
    const editor = openEditor()
    const { unmount } = render(<LiveLinkTitles editor={editor} />)
    expect(liveTitleKey.getState(editor.state)).toEqual([])
    unmount()
    expect(liveTitleKey.getState(editor.state)).toBeUndefined()
  })

  it('draw again when the application’s lookup changes', () => {
    const editor = openEditor()
    const seen: unknown[] = []
    editor.on('transaction', ({ transaction }) => seen.push(transaction.getMeta(liveTitleKey)))
    const { rerender } = render(
      <LinkPreviewProvider value={NO_LINK_PREVIEWS}>
        <LiveLinkTitles editor={editor} />
      </LinkPreviewProvider>,
    )
    rerender(
      <LinkPreviewProvider value={another}>
        <LiveLinkTitles editor={editor} />
      </LinkPreviewProvider>,
    )
    expect(seen).toContain('redraw')
  })

  it('leave an editor that has already been destroyed alone, whether it is torn down or told of a new lookup', () => {
    const editor = openEditor()
    const { rerender, unmount } = render(
      <LinkPreviewProvider value={NO_LINK_PREVIEWS}>
        <LiveLinkTitles editor={editor} />
      </LinkPreviewProvider>,
    )
    editor.destroy()
    expect(() => {
      rerender(
        <LinkPreviewProvider value={another}>
          <LiveLinkTitles editor={editor} />
        </LinkPreviewProvider>,
      )
      unmount()
    }).not.toThrow()
  })
})
