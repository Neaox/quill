import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { serializeDocument } from '../pipeline/serialize-document.ts'
import { renderHtml } from '../render/html.ts'
import { readCommentAttributes, writeCommentAttributes } from './link-comment.ts'

const URL_A = 'https://blog.example/post'

const roundTrip = (markdown: string) => {
  const { frontMatter, ast } = parseDocument(markdown)
  return serializeDocument({ frontMatter, ast })
}

describe('the attribute list of a Quill link comment', () => {
  it('reads plain words, quoted values and bare flags, in order', () => {
    expect(
      readCommentAttributes('display=card layout=top title="Our take" image=none description'),
    ).toEqual({
      display: 'card',
      layout: 'top',
      title: 'Our take',
      image: 'none',
      description: '',
    })
  })

  it('reads an empty list as nothing', () => {
    expect(readCommentAttributes('')).toEqual({})
  })

  it.each(['=x', 'a="unclosed', 'display="x" =y'])('does not read %s', (source) => {
    expect(readCommentAttributes(source)).toBeNull()
  })

  it('writes in the order given, quoting whatever is not a plain word', () => {
    expect(writeCommentAttributes({ display: 'card', title: 'Our take', image: 'none' })).toBe(
      '<!-- quill:link display=card title="Our take" image=none -->',
    )
  })

  it('writes a flag with no value bare, as a directive does', () => {
    expect(writeCommentAttributes({ description: '' })).toBe('<!-- quill:link description -->')
  })

  it.each([
    'say "hi"',
    'back\\slash',
    'a--b and --> too',
    'two\nlines',
    '<!-- nested -->',
    'https://x.example/a-b?c=d&e=f',
    'plain',
  ])('writes %j so that it reads back as itself and cannot end the comment early', (value) => {
    const written = writeCommentAttributes({ title: value })
    const inner = written.slice('<!-- quill:link '.length, -' -->'.length)
    expect(inner).not.toContain('--')
    expect(readCommentAttributes(inner)).toEqual({ title: value })
  })
})

describe('reading: a link and its comment are a link directive', () => {
  it('reads a link alone in its paragraph as a block, keeping the words', () => {
    const { ast } = parseDocument(
      `[the design doc](${URL_A}) <!-- quill:link display=card layout=top -->\n`,
    )
    expect(ast.children[0]).toMatchObject({
      type: 'leafDirective',
      name: 'link',
      attributes: { url: URL_A, display: 'card', layout: 'top' },
      children: [{ type: 'text', value: 'the design doc' }],
    })
  })

  it('reads a link in a sentence as inline', () => {
    const { ast } = parseDocument(
      `See [the doc](${URL_A})<!-- quill:link display=inline --> now.\n`,
    )
    const paragraph = ast.children[0]
    expect(paragraph?.type).toBe('paragraph')
    expect(
      paragraph && 'children' in paragraph && paragraph.children.map((child) => child.type),
    ).toEqual(['text', 'textDirective', 'text'])
  })

  it('reads a link with only space before its comment the same way', () => {
    const { ast } = parseDocument(`See [x](${URL_A}) <!-- quill:link display=inline --> now.\n`)
    const paragraph = ast.children[0]
    expect(
      paragraph && 'children' in paragraph && paragraph.children.map((child) => child.type),
    ).toContain('textDirective')
  })

  it('leaves a link with no comment alone, which is a plain link', () => {
    expect(parseDocument(`[x](${URL_A})\n`).ast.children[0]?.type).toBe('paragraph')
  })

  it('leaves another comment, and a comment with nothing before it, alone', () => {
    expect(roundTrip(`[x](${URL_A}) <!-- a note -->\n`)).toBe(`[x](${URL_A}) <!-- a note -->\n`)
    expect(roundTrip('<!-- quill:link display=card -->\n')).toBe(
      '<!-- quill:link display=card -->\n',
    )
  })

  it('keeps the first paragraph of a list item inline, since a block cannot go there', () => {
    const { ast } = parseDocument(`- [x](${URL_A}) <!-- quill:link display=card -->\n`)
    const list = ast.children[0]
    const item = list && 'children' in list ? list.children[0] : undefined
    const first = item && 'children' in item ? item.children[0] : undefined
    expect(first?.type).toBe('paragraph')
  })

  it('draws as the card it says, in the rendered body', () => {
    const html = renderHtml(parseMarkdown(`[x](${URL_A}) <!-- quill:link display=card -->\n`))
    expect(html).toContain('data-link-slot')
    expect(html).toContain('data-display="card"')
  })
})

describe('writing: a link directive is a link and a comment', () => {
  it('keeps what an unchanged document says, byte for byte', () => {
    for (const markdown of [
      `[the design doc](${URL_A}) <!-- quill:link display=card layout=top -->\n`,
      `See [the doc](${URL_A})<!-- quill:link display=inline --> now.\n`,
      `<${URL_A}> <!-- quill:link display=compact -->\n`,
      `[x](${URL_A}) <!-- quill:link layout=top display=card -->\n`,
    ]) {
      expect(roundTrip(markdown)).toBe(markdown)
    }
  })

  it('writes a link made in the editor, which has no source form, as a link and a comment', () => {
    const { ast } = parseDocument('x\n')
    const leaf = {
      type: 'leafDirective' as const,
      name: 'link',
      attributes: { url: URL_A, display: 'card' },
      children: [],
    }
    expect(serializeDocument({ frontMatter: {}, ast: { ...ast, children: [leaf] } })).toBe(
      `<${URL_A}> <!-- quill:link display=card -->\n`,
    )
  })

  it('writes an inline one next to its words with no space, so a sentence reads as it did', () => {
    const { ast } = parseDocument('x\n')
    const inline = {
      type: 'paragraph' as const,
      children: [
        { type: 'text' as const, value: 'See ' },
        {
          type: 'textDirective' as const,
          name: 'link',
          attributes: { url: URL_A, display: 'inline' },
          children: [{ type: 'text' as const, value: 'the doc' }],
        },
        { type: 'text' as const, value: ' now.' },
      ],
    }
    expect(serializeDocument({ frontMatter: {}, ast: { ...ast, children: [inline] } })).toBe(
      `See [the doc](${URL_A})<!-- quill:link display=inline --> now.\n`,
    )
  })

  it('keeps the older directive form as it was written until it changes', () => {
    for (const markdown of [
      `:link[${URL_A}]{display=inline}\n`,
      `::link{url="${URL_A}" display=card}\n`,
      `See :link[the doc]{url="${URL_A}" display=inline}.\n`,
    ]) {
      expect(roundTrip(markdown)).toBe(markdown)
    }
  })

  it('keeps an attribute it does not know', () => {
    const markdown = `[x](${URL_A}) <!-- quill:link display=card future=yes -->\n`
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('degrades to the plain link when the comment is dropped', () => {
    const written = roundTrip(`[the doc](${URL_A}) <!-- quill:link display=card -->\n`)
    expect(written.replace(/<!--.*?-->/gu, '').trim()).toBe(`[the doc](${URL_A})`)
  })
})
