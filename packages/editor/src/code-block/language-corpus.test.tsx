import { EditorView as CodeMirrorView } from '@codemirror/view'
import { CODE_LANGUAGES, highlight, resolveLanguage, unpackRanges } from '@quill/highlight'
import type { TokenRange } from '@quill/highlight'
import { corpusDocument } from '@quill/highlight/corpus'
import { parseDocument, renderHtml } from '@quill/markdown'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import { paintedRanges } from './token-painting.ts'

/**
 * The language corpus — one block in every registered language — in both
 * surfaces at once: rendered for the reader as the server renders it, and
 * opened in the editor. Every block must be coloured, and coloured
 * identically, range for range and class for class (ADR-030).
 */

const corpus = corpusDocument()

/** What the reader paints: each block's text and the ranges the server embedded. */
function readerBlocks(): Array<{ readonly language: string; readonly ranges: TokenRange[] }> {
  const html = renderHtml(parseDocument(corpus).ast, {
    highlighter: (text, fence) => {
      const language = resolveLanguage(fence)
      return language === null ? null : { language, tokens: highlight(text, language).packed }
    },
  })
  const page = document.createElement('div')
  page.innerHTML = html
  return [...page.querySelectorAll('pre > code')].map((code) => ({
    language: code.getAttribute('data-lang') ?? '',
    ranges: unpackRanges(code.getAttribute('data-tokens') ?? ''),
  }))
}

/** Every code editor on the page, in document order. */
const views = () =>
  [...document.querySelectorAll('.code-block-editor .cm-editor')].map((host) =>
    host instanceof HTMLElement ? CodeMirrorView.findFromDOM(host) : null,
  )

/** What the editor paints, block by block, once the grammars have loaded. */
async function editorBlocks(): Promise<TokenRange[][]> {
  render(<DocumentEditor ast={parseDocument(corpus).ast} />)
  await expect
    .poll(() => views().every((view) => view !== null && paintedRanges(view.state).length > 0))
    .toBe(true)
  return views().map((view) => (view === null ? [] : paintedRanges(view.state)))
}

describe('the language corpus, read and written', () => {
  it('colours every registered language identically in the reader and the editor', async () => {
    const reader = readerBlocks()
    const editor = await editorBlocks()

    expect(reader.map((block) => block.language)).toEqual(
      CODE_LANGUAGES.map((language) => language.grammar),
    )
    expect(editor).toHaveLength(reader.length)
    reader.forEach((block, index) => {
      expect(block.ranges.length, `${block.language} is not coloured`).toBeGreaterThan(0)
      expect(editor[index], `${block.language} differs`).toEqual(block.ranges)
    })
  })
})
