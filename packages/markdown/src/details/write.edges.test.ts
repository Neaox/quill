import type { Paragraph, PhrasingContent, Root, RootContent } from 'mdast'
import { describe, expect, it } from 'vitest'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import type { Details } from './details.ts'
import { detailsDirectiveOf, keepsSyntax } from './write.ts'

const text = (value: string): PhrasingContent => ({ type: 'text', value })

const summary = (...children: PhrasingContent[]): Paragraph => ({
  type: 'paragraph',
  data: { directiveLabel: true },
  children,
})

const body = (value: string): Paragraph => ({ type: 'paragraph', children: [text(value)] })

function details(parts: Partial<Details> & Pick<Details, 'syntax'>): Details {
  return { type: 'details', attributes: {}, children: [], ...parts }
}

const write = (...children: RootContent[]): string =>
  stringifyMdast({ type: 'root', children } satisfies Root)

describe('what an HTML summary can hold on one line', () => {
  it('holds a link to a plain address, which stays HTML', () => {
    const link: PhrasingContent = { type: 'link', url: '/docs', children: [text('docs')] }

    expect(write(details({ syntax: 'html', children: [summary(link), body('x')] }))).toBe(
      '<details>\n<summary>[docs](/docs)</summary>\n\nx\n\n</details>\n',
    )
  })

  it.each([
    ['a link with a title', { type: 'link', url: '/docs', title: 'Docs', children: [text('d')] }],
    [
      'a link to an address that needs brackets',
      { type: 'link', url: '/a b', children: [text('d')] },
    ],
    ['a picture', { type: 'image', url: '/a.png', alt: 'a' }],
    ['a hard break', { type: 'break' }],
  ] satisfies [string, PhrasingContent][])('moves %s to the directive', (_name, child) => {
    expect(write(details({ syntax: 'html', children: [summary(child), body('x')] }))).toMatch(
      /^:::details\[/u,
    )
  })

  it('holds a text directive, and moves one whose attribute has a tag in it to the directive', () => {
    const kbd: PhrasingContent = {
      type: 'textDirective',
      name: 'kbd',
      attributes: { title: null },
      children: [text('Ctrl')],
    }
    const bare: PhrasingContent = { type: 'textDirective', name: 'kbd', children: [text('Ctrl')] }
    const tagged: PhrasingContent = {
      type: 'textDirective',
      name: 'abbr',
      attributes: { title: 'a < b' },
      children: [text('x')],
    }

    expect(write(details({ syntax: 'html', children: [summary(kbd), body('x')] }))).toMatch(
      /^<details>/u,
    )
    expect(write(details({ syntax: 'html', children: [summary(bare), body('x')] }))).toMatch(
      /^<details>/u,
    )
    expect(write(details({ syntax: 'html', children: [summary(tagged), body('x')] }))).toMatch(
      /^:::details/u,
    )
  })

  it('holds emphasis, strong text and deleted text, and code with no tag in it', () => {
    const children: PhrasingContent[] = [
      { type: 'emphasis', children: [text('a')] },
      { type: 'strong', children: [text('b')] },
      { type: 'delete', children: [text('c')] },
      { type: 'inlineCode', value: 'd' },
    ]

    expect(keepsSyntax(details({ syntax: 'html', children: [summary(...children)] }))).toBe(true)
    expect(
      keepsSyntax(
        details({
          syntax: 'html',
          children: [
            summary({ type: 'emphasis', children: [{ type: 'inlineCode', value: '<b>' }] }),
          ],
        }),
      ),
    ).toBe(false)
  })
})

describe('writing a details the editor made', () => {
  it('writes an empty HTML details with no summary on two lines', () => {
    expect(write(details({ syntax: 'html' }))).toBe('<details>\n\n</details>\n')
  })

  it('writes a callout details closed, and open, with its kind in the marker', () => {
    const children = [summary(text('Title')), body('x')]

    expect(write(details({ syntax: 'callout', attributes: { type: 'tip' }, children }))).toBe(
      '> [!tip]- Title\n>\n> x\n',
    )
    expect(
      write(details({ syntax: 'callout', attributes: { type: 'tip', open: '' }, children })),
    ).toBe('> [!tip]+ Title\n>\n> x\n')
  })

  it('writes a callout details that has a kind but no title or body as its marker alone', () => {
    expect(write(details({ syntax: 'callout', attributes: { type: 'tip' } }))).toBe('> [!tip]-\n')
  })

  it('keeps the data it carries when it is written as the directive', () => {
    const named = details({
      syntax: 'html',
      attributes: { name: 'faq' },
      data: { sourceForm: { blankLines: 0 } },
      children: [body('x')],
    })

    expect(detailsDirectiveOf(named).data).toEqual({ sourceForm: { blankLines: 0 } })
    expect(detailsDirectiveOf({ ...named, data: undefined })).not.toHaveProperty('data')
  })
})

describe('a details written straight under the block before it', () => {
  const straight = (title: string): Details =>
    details({
      syntax: 'callout',
      attributes: { type: 'note' },
      data: { sourceForm: { blankLines: 0 } },
      children: [summary(text(title)), body('x')],
    })

  it('stays straight under a paragraph', () => {
    const markdown = 'Intro:\n> [!note]- A\n> x\n'

    expect(stringifyMdast(parseMarkdown(markdown))).toBe(markdown)
  })

  it('is set apart from a quote or a callout before it, which would take it in', () => {
    const quote: RootContent = { type: 'blockquote', children: [body('quoted')] }

    expect(write(quote, straight('A'))).toBe('> quoted\n\n> [!note]- A\n>\n> x\n')
    expect(write(straight('A'), straight('B'))).toBe(
      '> [!note]- A\n>\n> x\n\n> [!note]- B\n>\n> x\n',
    )
  })

  it('is set apart, as any block is, when it was not written straight under', () => {
    expect(write(body('Intro:'), details({ syntax: 'html', children: [body('x')] }))).toBe(
      'Intro:\n\n<details>\n\nx\n\n</details>\n',
    )
  })
})
