import remarkGfm from 'remark-gfm'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import type { Root, RootContent } from 'mdast'

import { isRawMdast, rawMdast, rawMdastToMarkdown } from './raw-mdast.ts'
import { parseMarkdown, stringifyMdast } from './processor.ts'
import { replaceUnserialisable, SERIALISABLE_TYPES } from './serialisable.ts'
import { DIRECTIVE_COLON_ESCAPE, remarkToMarkdownExtensions } from './to-markdown-extensions.ts'

/** One paragraph of literal text, to see exactly what the serialiser escapes. */
function text(value: string): Root {
  return { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value }] }] }
}

/** A node type no version of this package models, as a future one might produce. */
function invented(): RootContent {
  const node = {
    type: 'somethingNeverSeen',
    children: [{ type: 'text', value: 'carried through' }],
  }
  return node as unknown as RootContent
}

describe('rawMdast', () => {
  it('recognises its own nodes and nothing else', () => {
    expect(isRawMdast(rawMdast('anything'))).toBe(true)
    expect(isRawMdast({ type: 'paragraph' })).toBe(false)
  })

  it('is written back verbatim, with no escaping at all', () => {
    const tree: Root = { type: 'root', children: [rawMdast('<!-- kept :: exactly -->')] }

    expect(stringifyMdast(tree)).toBe('<!-- kept :: exactly -->\n')
  })

  it('declares a handler for its own node type', () => {
    expect(Object.keys(rawMdastToMarkdown.handlers ?? {})).toEqual(['rawMdast'])
  })
})

describe('replaceUnserialisable', () => {
  it('leaves a tree the serialiser understands alone', () => {
    const tree = parseMarkdown('# Heading\n\nText.\n')
    const { tree: result, warnings } = replaceUnserialisable(tree)

    expect(warnings).toEqual([])
    expect(stringifyMdast(result)).toBe('# Heading\n\nText.\n')
  })

  it('degrades a node type it cannot write to that node text, with a warning', () => {
    const tree: Root = { type: 'root', children: [invented()] }
    const { tree: result, warnings } = replaceUnserialisable(tree)

    expect(warnings).toEqual([{ code: 'unserialisable-node', detail: 'somethingNeverSeen' }])
    expect(stringifyMdast(result)).toBe('carried through\n')
  })

  it('degrades that text as text, never as Markdown', () => {
    // The bug this guards: writing it on the `rawMdast` escape hatch emitted it
    // verbatim, so a node whose text happened to read `# Heading` came back as a
    // heading and one reading `- item` as a list. Text stays text.
    const tree: Root = {
      type: 'root',
      children: [
        { type: 'somethingNeverSeen', children: [{ type: 'text', value: '# Not a heading' }] },
        { type: 'somethingNeverSeen', children: [{ type: 'text', value: ':::callout' }] },
      ] as unknown as RootContent[],
    }
    const { tree: result } = replaceUnserialisable(tree)
    const markdown = stringifyMdast(result)

    expect(markdown).toBe('\\# Not a heading\n\n\\:\\:\\:callout\n')
    expect(parseMarkdown(markdown).children.every((child) => child.type === 'paragraph')).toBe(true)
  })

  it('degrades an inline node to text, where a paragraph could not go', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'before ' },
            { type: 'neverSeenInline', children: [{ type: 'text', value: 'middle' }] },
            { type: 'text', value: ' after' },
          ],
        },
      ] as unknown as RootContent[],
    }
    const { tree: result } = replaceUnserialisable(tree)

    expect(stringifyMdast(result)).toBe('before middle after\n')
  })

  it('lists every node type the configured serialiser can write', () => {
    for (const type of ['containerDirective', 'yaml', 'table', 'rawMdast', 'footnoteReference']) {
      expect(SERIALISABLE_TYPES.has(type)).toBe(true)
    }
    expect(SERIALISABLE_TYPES.has('somethingNeverSeen')).toBe(false)
  })
})

describe('remarkToMarkdownExtensions', () => {
  it('escapes every colon of a run, and any that would start a directive', () => {
    // `\:\::b` is the shape that used to get through: two of three colons
    // escaped, the third re-reading as the text directive `:b`.
    expect(stringifyMdast(text('a:::b'))).toBe('a\\:\\:\\:b\n')
    expect(stringifyMdast(text('a::b'))).toBe('a\\:\\:b\n')
    // `mdast-util-directive` escapes `:` before a letter; a directive name may
    // start with a digit or any non-punctuation character, and so must this.
    expect(stringifyMdast(text('3:2::'))).toBe('3\\:2\\:\\:\n')
    expect(stringifyMdast(text('a:9front'))).toBe('a\\:9front\n')
    // Ordinary prose keeps its colons: no directive name can start with a
    // space or with punctuation, so neither of these is touched.
    expect(stringifyMdast(text('Note: this one.'))).toBe('Note: this one.\n')
    expect(stringifyMdast(text('Ratio 3 : 2 and -: and .:'))).toBe('Ratio 3 : 2 and -: and .:\n')
  })

  it('writes a byte-order mark as a character reference, so a parse cannot eat it', () => {
    expect(stringifyMdast(text('a﻿b'))).toBe('a&#xFEFF;b\n')
  })

  it('creates the extension list when no other plugin has', () => {
    const processor = unified().use(remarkToMarkdownExtensions).freeze()

    expect(processor.data('toMarkdownExtensions')).toHaveLength(3)
  })

  it('appends to a list another plugin already created', () => {
    const processor = unified().use(remarkGfm).use(remarkToMarkdownExtensions).freeze()
    const extensions = processor.data('toMarkdownExtensions') ?? []

    expect(extensions.length).toBeGreaterThan(2)
    expect(extensions).toContain(DIRECTIVE_COLON_ESCAPE)
  })
})
