import { describe, expect, it } from 'vitest'

import { choosePaste } from './paste.ts'
import type { PasteInput } from './paste.ts'

function paste(input: Partial<PasteInput>): PasteInput {
  return { text: '', html: '', inCode: false, hasSelection: false, ...input }
}

describe('what the editor does with the clipboard', () => {
  it('reads plain text as Markdown', () => {
    expect(choosePaste(paste({ text: '## A heading' }))).toEqual({
      kind: 'markdown',
      text: '## A heading',
    })
  })

  it('turns a URL pasted over a selection into a link', () => {
    const input = paste({ text: 'https://example.com/a', hasSelection: true })
    expect(choosePaste(input)).toEqual({ kind: 'link', href: 'https://example.com/a' })
  })

  it('ignores the space around a pasted URL, which a browser often adds', () => {
    const input = paste({ text: '  https://example.com/a\n', hasSelection: true })
    expect(choosePaste(input)).toEqual({ kind: 'link', href: 'https://example.com/a' })
  })

  it('pastes a URL as text when nothing is selected for it to describe', () => {
    const input = paste({ text: 'https://example.com/a' })
    expect(choosePaste(input).kind).toBe('markdown')
  })

  it('leaves a URL with anything after it to Markdown, selection or not', () => {
    const input = paste({ text: 'https://example.com/a and more', hasSelection: true })
    expect(choosePaste(input).kind).toBe('markdown')
  })

  it('leaves something that is not an address alone', () => {
    const input = paste({ text: 'mailto:someone@example.com', hasSelection: true })
    expect(choosePaste(input).kind).toBe('markdown')
  })

  it('leaves rich content to ProseMirror, which already understands it', () => {
    expect(choosePaste(paste({ text: 'A', html: '<p>A</p>' })).kind).toBe('default')
  })

  it('still links a URL pasted over a selection from a rich source', () => {
    const input = paste({ text: 'https://example.com', html: '<a>x</a>', hasSelection: true })
    expect(choosePaste(input).kind).toBe('link')
  })

  it('leaves a paste inside a code block alone, where text is only text', () => {
    expect(choosePaste(paste({ text: '## Not a heading', inCode: true })).kind).toBe('default')
  })

  it('has nothing to do with an empty clipboard', () => {
    expect(choosePaste(paste({ text: '   ' })).kind).toBe('default')
  })
})
