import { describe, expect, it } from 'vitest'

import { createHighlighter, MAX_EMBEDDED_HIGHLIGHT_CHARS } from './highlighter.ts'

describe('createHighlighter', () => {
  const highlight = createHighlighter()

  it('packs token ranges for a language it knows, and names the grammar they came from', () => {
    const highlighted = highlight('const a = 1', 'ts')
    // The fence tag was `ts`; `data-lang` must report the grammar the ranges
    // were actually produced for, not the abbreviation (ADR-030).
    expect(highlighted).toEqual({ language: 'typescript', tokens: expect.stringMatching(/^1:/) })
  })

  it('leaves a block in an unregistered language for the reader', () => {
    expect(highlight('some text', 'brainfuck')).toBeNull()
  })

  it('leaves a block above the size threshold to be highlighted on demand', () => {
    const large = 'x'.repeat(MAX_EMBEDDED_HIGHLIGHT_CHARS + 1)
    expect(highlight(large, 'ts')).toBeNull()
    expect(createHighlighter({ maxChars: 4 })('const a = 1', 'ts')).toBeNull()
  })

  it('degrades to no ranges rather than failing a render when the tokenizer cannot run', () => {
    const failing = createHighlighter({
      pack: () => {
        throw new Error('no grammar registered in this runtime')
      },
    })
    expect(failing('const a = 1', 'ts')).toBeNull()
  })
})
