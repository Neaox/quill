import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import type { EditorLinkPreview, LinkPreviewSource } from '../blocks/link-preview-context.tsx'

const DOC = '/d/0192f0a4-7c1e-7a3b-8d1e-4a5b6c7d8e9f'
const PREVIEW: EditorLinkPreview = {
  title: 'Deploy runbook',
  description: null,
  siteName: 'Runbooks',
  thumbnail: null,
  favicon: null,
  layer: 'internal',
}

function sourceOf(known: Record<string, EditorLinkPreview>) {
  const request = vi.fn<(url: string) => void>()
  const source: LinkPreviewSource = {
    preview: (url) => known[url] ?? null,
    request,
    imageUrl: ({ hash }) => `/pictures/${hash}`,
  }
  return { source, request }
}

function open(markdown: string, source: LinkPreviewSource) {
  return render(<DocumentEditor ast={parseDocument(markdown).ast} linkPreviews={source} />)
}

const titles = (container: HTMLElement) =>
  [...container.querySelectorAll('.link-live-title')].map((element) => element.textContent)

describe('the live title of a link to a document, while writing', () => {
  it('stands in place of the address once the title is known, and the address is hidden from assistive technology', async () => {
    const { source } = sourceOf({ [DOC]: PREVIEW })
    const { container } = open(`See :link[${DOC}]{display=inline} now.\n`, source)
    expect(titles(container)).toEqual(['Deploy runbook'])
    const hidden = container.querySelector('.link-live-source')
    expect(hidden).toHaveAttribute('aria-hidden', 'true')
    expect(hidden).toHaveTextContent(DOC)
    await expectNoAccessibilityViolations(container)
  })

  it('shows the address while the title is on its way, and asks for it', () => {
    const { source, request } = sourceOf({})
    const { container } = open(`See :link[${DOC}]{display=inline} now.\n`, source)
    expect(titles(container)).toEqual([])
    expect(container.querySelector('.link-live-source')).toBeNull()
    expect(request).toHaveBeenCalledWith(DOC)
  })

  it('leaves the author’s own words alone, as the reader does', () => {
    const { source } = sourceOf({ [DOC]: PREVIEW })
    const { container } = open(`See :link[the runbook]{url="${DOC}" display=inline}.\n`, source)
    expect(titles(container)).toEqual([])
  })

  it('leaves a link shown as a plain link alone', () => {
    const { source } = sourceOf({ [DOC]: PREVIEW })
    const { container } = open(`See :link[${DOC}]{display=url}.\n`, source)
    expect(titles(container)).toEqual([])
  })

  it('leaves a link to the web alone: only documents of this instance are asked about', () => {
    const { source, request } = sourceOf({ 'https://blog.example/x': PREVIEW })
    const { container } = open('See :link[https://blog.example/x]{display=inline}.\n', source)
    expect(titles(container)).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })

  it('changes nothing about the document: the file still holds the address', () => {
    const { source } = sourceOf({ [DOC]: PREVIEW })
    const markdown = `See :link[${DOC}]{display=inline}.
`
    let handle: DocumentEditorHandle | null = null
    render(
      <DocumentEditor
        ast={parseDocument(markdown).ast}
        linkPreviews={source}
        ref={(value) => {
          handle = value
        }}
      />,
    )
    const saved = handle === null ? null : (handle as DocumentEditorHandle).toMdast()
    expect(saved).not.toBeNull()
    expect(serializeDocument({ frontMatter: {}, ast: saved ?? parseDocument('').ast })).toBe(
      `See :link[${DOC}]{display=inline}.
`,
    )
  })

  it('gives the address back, to be edited, when the caret is in the link', () => {
    const { source } = sourceOf({ [DOC]: PREVIEW })
    let handle: DocumentEditorHandle | null = null
    const { container } = render(
      <DocumentEditor
        ast={
          parseDocument(`See :link[${DOC}]{display=inline}.
`).ast
        }
        linkPreviews={source}
        ref={(value) => {
          handle = value
        }}
      />,
    )
    const editor = (handle as DocumentEditorHandle | null)?.editor
    if (editor === null || editor === undefined) throw new Error('no editor')
    expect(titles(container)).toEqual(['Deploy runbook'])
    // Inside the link's text: the caret is among its address.
    act(() => {
      editor.commands.setTextSelection(8)
    })
    expect(titles(container)).toEqual([])
    expect(container.querySelector('.link-live-source')).toBeNull()
    // Back out, and the title returns.
    act(() => {
      editor.commands.setTextSelection(1)
    })
    expect(titles(container)).toEqual(['Deploy runbook'])
  })

  describe('as the document is edited', () => {
    function editorWith(markdown: string, known: Record<string, EditorLinkPreview>) {
      const { source } = sourceOf(known)
      let handle: DocumentEditorHandle | null = null
      const { container } = render(
        <DocumentEditor
          ast={parseDocument(markdown).ast}
          linkPreviews={source}
          ref={(value) => {
            handle = value
          }}
        />,
      )
      const editor = (handle as DocumentEditorHandle | null)?.editor
      if (editor === null || editor === undefined) throw new Error('no editor')
      return { editor, container }
    }

    it('keeps the title on the right link when text is typed before it', () => {
      const { editor, container } = editorWith(
        `See :link[${DOC}]{display=inline} now.
`,
        {
          [DOC]: PREVIEW,
        },
      )
      act(() => {
        editor.commands.insertContentAt(1, 'Please ')
      })
      expect(titles(container)).toEqual(['Deploy runbook'])
      expect(container.querySelector('.link-live-source')).toHaveTextContent(DOC)
    })

    it('follows the address as it is changed, and gives up the title when it stops being a document', () => {
      const { editor, container } = editorWith(
        `See :link[${DOC}]{display=inline} now.
`,
        {
          [DOC]: PREVIEW,
        },
      )
      act(() => {
        // Replace the address's text with something that is not a document.
        editor.commands.insertContentAt({ from: 5, to: 5 + DOC.length }, 'nothing')
      })
      expect(titles(container)).toEqual([])
    })

    it('draws a link that is added later, and stops drawing one that is deleted', () => {
      const { editor, container } = editorWith(
        `Nothing here.
`,
        { [DOC]: PREVIEW },
      )
      expect(titles(container)).toEqual([])
      act(() => {
        editor.commands.insertContentAt(
          1,
          {
            type: 'textDirective',
            attrs: { name: 'link', attributes: { display: 'inline' } },
            content: [{ type: 'text', text: DOC }],
          },
          { updateSelection: false },
        )
      })
      expect(titles(container)).toEqual(['Deploy runbook'])
      act(() => {
        editor.commands.deleteRange({ from: 1, to: 2 + DOC.length })
      })
      expect(titles(container)).toEqual([])
    })
  })
})
