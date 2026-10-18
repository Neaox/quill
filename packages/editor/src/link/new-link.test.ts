import { GapCursor } from '@tiptap/pm/gapcursor'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { pasteDocumentLink, previewableAddress } from './new-link.ts'

const harness = createEditorTestHarness()
const ADDRESS = '/d/0192f0a4-7c1e-7a3b-8d1e-4a5b6c7d8e9f'

function caretAtEnd(markdown: string): EditorState {
  const opened = harness.state(markdown)
  return opened.apply(
    opened.tr.setSelection(TextSelection.create(opened.doc, opened.doc.content.size - 1)),
  )
}

describe('pasting a link to another document', () => {
  it('puts an inline link by its id at the caret', () => {
    const state = caretAtEnd('See ')
    let next = state
    expect(
      pasteDocumentLink(ADDRESS)(state, (tr) => {
        next = state.apply(tr)
      }),
    ).toBe(true)
    const written = harness.read(documentToMdast(next.doc).tree)
    expect(written).toContain(ADDRESS)
    expect(written).toContain('quill:link display=inline')
  })

  it('says it can without doing it, when only asked', () => {
    const state = caretAtEnd('See ')
    expect(pasteDocumentLink(ADDRESS)(state, undefined)).toBe(true)
  })

  it('cannot go where no inline content can', () => {
    const opened = harness.state('<https://blog.example/post> <!-- quill:link display=card -->\n')
    const state = opened.apply(opened.tr.setSelection(new GapCursor(opened.doc.resolve(0))))
    expect(pasteDocumentLink(ADDRESS)(state, undefined)).toBe(false)
  })
})

describe('an address worth previewing', () => {
  it.each(['https://blog.example/post', 'http://blog.example/a?b=c#d'])('accepts %s', (address) => {
    expect(previewableAddress(`  ${address}\n`)).toBe(address)
  })

  it.each([
    'blog.example/post',
    'ftp://blog.example/post',
    'https://blog.example/a b',
    'two words',
    '',
  ])('does not take %j for one', (text) => {
    expect(previewableAddress(text)).toBeNull()
  })

  it('does not take an address the platform cannot read', () => {
    expect(previewableAddress('https://[not-an-address')).toBeNull()
  })
})
