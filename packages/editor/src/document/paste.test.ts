import { describe, expect, it } from 'vitest'

import { choosePaste } from './paste.ts'
import type { PasteInput } from './paste.ts'

function paste(input: Partial<PasteInput>): PasteInput {
  return { text: '', html: '', inCode: false, hasSelection: false, hasFiles: false, ...input }
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

  it('pastes a bare URL as a link of its own when nothing is selected for it to describe', () => {
    const input = paste({ text: ' https://example.com/a\n' })
    expect(choosePaste(input)).toEqual({ kind: 'address', href: 'https://example.com/a' })
  })

  it('does the same for an address copied from a page, which brings a fragment of HTML with it', () => {
    const input = paste({
      text: 'https://example.com/a',
      html: '<a href="https://example.com/a">x</a>',
    })
    expect(choosePaste(input).kind).toBe('address')
  })

  describe('an address of another document of this instance', () => {
    const origin = 'https://quill.example'
    const id = '0192f0a4-7c1e-7a3b-8d1e-4a5b6c7d8e9f'

    it('is linked by its id, whatever readable words and workspace the address carried', () => {
      expect(choosePaste(paste({ text: `${origin}/d/${id}`, origin }))).toEqual({
        kind: 'document',
        address: `/d/${id}`,
      })
      expect(
        choosePaste(paste({ text: `${origin}/w/engineering/d/the-title-k7m3q9v2xd`, origin })),
      ).toEqual({ kind: 'document', address: '/d/the-title-k7m3q9v2xd' })
    })

    it('links a selection to the id address, not to the full URL', () => {
      const input = paste({ text: `${origin}/d/${id}`, hasSelection: true, origin })
      expect(choosePaste(input)).toEqual({ kind: 'link', href: `/d/${id}` })
    })

    it('leaves an address on another site, and a page of this one that is not a document, as links', () => {
      expect(choosePaste(paste({ text: `https://other.example/d/${id}`, origin })).kind).toBe(
        'address',
      )
      expect(choosePaste(paste({ text: `${origin}/preferences`, origin })).kind).toBe('address')
    })

    it('is an ordinary address where the editor does not know its origin', () => {
      expect(choosePaste(paste({ text: `${origin}/d/${id}` })).kind).toBe('address')
    })
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

  it('leaves a copied file to the file handler, whatever text comes with it', () => {
    expect(choosePaste(paste({ text: 'diagram.png', hasFiles: true })).kind).toBe('default')
  })

  it('has nothing to do with an empty clipboard', () => {
    expect(choosePaste(paste({ text: '   ' })).kind).toBe('default')
  })
})
