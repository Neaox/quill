import { describe, expect, it } from 'vitest'
import type { Blockquote, Html, PhrasingContent, Root, RootContent } from 'mdast'
import type { ContainerDirective, TextDirective } from 'mdast-util-directive'

import { validateDirectives } from '../directives/registry.ts'
import { mdastToProseMirror } from '../prosemirror/from-mdast.ts'
import { schema } from '../prosemirror/schema.ts'
import { proseMirrorToMdast } from '../prosemirror/to-mdast.ts'
import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import type { Details } from './details.ts'
import { accordionDirective, detailsDirective, detailsModel, isDetails } from './details.ts'
import { readDetails } from './read.ts'

const text = (value: string): PhrasingContent => ({ type: 'text', value })

const readAsText = (value: string): PhrasingContent[] => [text(value)]

const html = (value: string): Html => ({ type: 'html', value })

const paragraph = (value: string): RootContent => ({ type: 'paragraph', children: [text(value)] })

const label = (value: string): RootContent => ({
  type: 'paragraph',
  data: { directiveLabel: true },
  children: [text(value)],
})

function detailsOf(markdown: string): Details {
  const [first] = parseMarkdown(markdown).children
  if (first === undefined || !isDetails(first)) throw new Error('expected a details')
  return first
}

const asRoot = (...children: RootContent[]): Root => ({
  type: 'root',
  children: children as Root['children'],
})

const fresh = (
  syntax: Details['syntax'],
  attributes: Details['attributes'],
  ...rest: RootContent[]
): Details => ({
  type: 'details',
  syntax,
  attributes,
  children: rest as Details['children'],
})

describe('a details with no attributes at all', () => {
  it('is a closed section nobody has named or typed', () => {
    const bare: ContainerDirective = { type: 'containerDirective', name: 'details', children: [] }
    expect(detailsModel(bare)).toMatchObject({
      open: false,
      name: undefined,
      kind: undefined,
      summary: undefined,
    })
  })
})

describe('checking a directive that only shares a name', () => {
  const inline: TextDirective = { type: 'textDirective', name: 'details', children: [] }
  const accordionInline: TextDirective = { type: 'textDirective', name: 'accordion', children: [] }

  it('has nothing to say about a details written inline', () => {
    expect(detailsDirective.validate(inline)).toEqual([])
  })

  it('has nothing to say about an accordion written inline', () => {
    expect(accordionDirective.validate(accordionInline)).toEqual([])
  })

  it('accepts an accordion that holds only details', () => {
    const markdown =
      '::::accordion\n:::details[A]\na\n:::\n\n<details>\n<summary>B</summary>\n\nb\n\n</details>\n::::\n'
    expect(validateDirectives(parseMarkdown(markdown))).toEqual([])
  })
})

describe('reading details out of a tree that was not parsed here', () => {
  it('reads tags in HTML that has no position, as a tree built by hand has none', () => {
    const tree: Root = {
      type: 'root',
      children: [html('<details>\n<summary>A</summary>'), paragraph('x'), html('</details>')],
    }
    const [read] = readDetails(tree, readAsText).children
    if (read === undefined || !isDetails(read)) throw new Error('expected a details')
    expect(read.children.map((child) => child.type)).toEqual(['paragraph', 'paragraph'])
    expect(detailsModel(read).summary?.children).toEqual([text('A')])
  })

  it('leaves HTML that is only whitespace as it is', () => {
    const tree: Root = { type: 'root', children: [html('  \n '), paragraph('x')] }
    expect(readDetails(tree, readAsText)).toEqual(tree)
  })

  it('reads nothing when something that is not a block stands inside the tags', () => {
    const tree: Root = {
      type: 'root',
      children: [html('<details>'), { type: 'yaml', value: 'a: 1' }, html('</details>')],
    }
    expect(readDetails(tree, readAsText)).toEqual(tree)
  })

  it('reads a foldable callout in a quote that has no position and carries data', () => {
    const quote: Blockquote = {
      type: 'blockquote',
      data: { sourceForm: { blankLines: 0 } },
      children: [
        { type: 'paragraph', children: [text('[!note]- Title')] },
        paragraph('body') as Blockquote['children'][number],
      ],
    }
    const [read] = readDetails({ type: 'root', children: [quote] }, readAsText).children
    if (read === undefined || !isDetails(read)) throw new Error('expected a details')
    expect(read.position).toBeUndefined()
    expect(read.data).toEqual({ sourceForm: { blankLines: 0 } })
  })

  it('reads a foldable callout in a quote that has neither', () => {
    const quote: Blockquote = {
      type: 'blockquote',
      children: [{ type: 'paragraph', children: [text('[!note]- Title')] }],
    }
    const [read] = readDetails({ type: 'root', children: [quote] }, readAsText).children
    if (read === undefined || !isDetails(read)) throw new Error('expected a details')
    expect(read).not.toHaveProperty('position')
    expect(read).not.toHaveProperty('data')
  })
})

describe('reading a foldable callout', () => {
  it('keeps a title that opens with markup', () => {
    const node = detailsOf('> [!note]- **Bold** title\n> body\n')
    expect(detailsModel(node).summary?.children.map((child) => child.type)).toEqual([
      'strong',
      'text',
    ])
  })

  it('ignores spaces that end a title on a line of its own', () => {
    const node = detailsOf('> [!note]- **Bold**&#32;\n> body\n')
    expect(detailsModel(node).summary?.children.map((child) => child.type)).toEqual(['strong'])
  })

  it('writes a callout that follows a paragraph with no blank line the way it was written', () => {
    const markdown = 'Intro:\n> [!tip]- A\n> x\n'
    expect(stringifyMdast(parseMarkdown(markdown))).toBe(markdown)
  })
})

describe('writing a details the editor made', () => {
  it('writes an HTML details with no summary', () => {
    expect(stringifyMdast(asRoot(fresh('html', {}, paragraph('x'))))).toBe(
      '<details>\n\nx\n\n</details>\n',
    )
  })

  it('writes an empty HTML details', () => {
    expect(stringifyMdast(asRoot(fresh('html', {}, label('A'))))).toBe(
      '<details>\n<summary>A</summary>\n\n</details>\n',
    )
  })

  it.each([
    ['a link', '[docs](https://example.com/a)', '<summary>[docs](https://example.com/a)</summary>'],
    ['emphasis', '*docs*', '<summary>*docs*</summary>'],
  ])('writes %s in an HTML summary as HTML', (_name, source, expected) => {
    const summary = parseMarkdown(`:::details[${source}]\nx\n:::\n`)
    const [node] = summary.children as [ContainerDirective]
    const [first] = node.children
    if (first === undefined) throw new Error('expected a summary')
    expect(stringifyMdast(asRoot(fresh('html', {}, first, paragraph('x'))))).toContain(expected)
  })

  it.each([
    ['a link with a title', '[docs](https://example.com "Docs")'],
    ['a link to an address with brackets', '[docs](<https://example.com/a(b)>)'],
    ['an image', '![alt](https://example.com/a.png)'],
    ['an inline directive with a long attribute', ':kbd[Ctrl]{title="a < b"}'],
  ])('writes %s in an HTML summary as the directive', (_name, source) => {
    const parsed = parseMarkdown(`:::details[${source}]\nx\n:::\n`)
    const [node] = parsed.children as [ContainerDirective]
    const [first] = node.children
    if (first === undefined) throw new Error('expected a summary')
    expect(stringifyMdast(asRoot(fresh('html', {}, first, paragraph('x'))))).toContain(
      ':::details[',
    )
  })

  it('writes an inline directive in an HTML summary when its attributes fit', () => {
    const parsed = parseMarkdown(':::details[:kbd[Ctrl]{title="plain"}]\nx\n:::\n')
    const [node] = parsed.children as [ContainerDirective]
    const [first] = node.children
    if (first === undefined) throw new Error('expected a summary')
    expect(stringifyMdast(asRoot(fresh('html', {}, first, paragraph('x'))))).toContain('<summary>')
  })

  it('writes an inline directive with no attributes, or a valueless one, in an HTML summary', () => {
    for (const attributes of [undefined, { flag: null }]) {
      const summary: RootContent = {
        type: 'paragraph',
        data: { directiveLabel: true },
        children: [
          {
            type: 'textDirective',
            name: 'kbd',
            ...(attributes === undefined ? {} : { attributes }),
            children: [text('Ctrl')],
          },
        ],
      }
      expect(stringifyMdast(asRoot(fresh('html', {}, summary, paragraph('x'))))).toContain(
        '<details>\n<summary>:kbd[Ctrl]',
      )
    }
  })

  it('writes a new Obsidian callout closed and open', () => {
    expect(
      stringifyMdast(
        asRoot(fresh('callout', { type: 'warning' }, label('Careful'), paragraph('x'))),
      ),
    ).toBe('> [!warning]- Careful\n>\n> x\n')
    expect(
      stringifyMdast(
        asRoot(fresh('callout', { type: 'warning', open: '' }, label('Careful'), paragraph('x'))),
      ),
    ).toBe('> [!warning]+ Careful\n>\n> x\n')
  })

  it('writes a callout details that has a name, which a marker cannot hold, as the directive', () => {
    const written = stringifyMdast(
      asRoot(fresh('callout', { type: 'tip', name: 'faq' }, label('A'), paragraph('x'))),
    )
    expect(written).toContain(':::details[A]')
    expect(written).toContain('name="faq"')
  })

  it('writes a callout details whose kind a marker cannot spell as the directive', () => {
    expect(
      stringifyMdast(asRoot(fresh('callout', { type: 'two words' }, label('A'), paragraph('x')))),
    ).toContain(':::details[A]')
  })

  it('writes an HTML details that has a name as the directive, keeping how it was spaced', () => {
    const tight = parseMarkdown('Intro:\n<details>\n<summary>A</summary>\n\nx\n\n</details>\n')
    const [intro, details] = tight.children
    if (intro === undefined || details === undefined || !isDetails(details)) {
      throw new Error('expected a paragraph and a details')
    }
    const named: Details = { ...details, attributes: { name: 'faq' } }
    expect(stringifyMdast(asRoot(intro, named))).toContain(':::details[A]')
  })

  it('keeps a callout apart from the quote it would otherwise join', () => {
    const tight = parseMarkdown('Intro:\n> [!tip]- A\n> x\n')
    const [intro, callout] = tight.children
    if (intro === undefined || callout === undefined || !isDetails(callout)) {
      throw new Error('expected a paragraph and a callout')
    }
    const quote: RootContent = {
      type: 'blockquote',
      children: [paragraph('q') as Blockquote['children'][number]],
    }
    const written = stringifyMdast(asRoot(quote, callout))
    expect(written).toBe('> q\n\n> [!tip]- A\n> x\n')
    expect(stringifyMdast(asRoot(callout, callout))).toBe('> [!tip]- A\n> x\n\n> [!tip]- A\n> x\n')
  })
})

describe('a details with an empty summary', () => {
  it('is read with no summary, and written back as it was', () => {
    const markdown = '<details>\n<summary></summary>\n\nx\n\n</details>\n'
    const node = detailsOf(markdown)
    expect(detailsModel(node).summary).toBeUndefined()
    expect(stringifyMdast(parseMarkdown(markdown))).toBe(markdown)
  })
})

describe('a details the editor opens and saves', () => {
  it('opens one made without a source or attributes, and saves it without inventing a source', () => {
    const made: Root = {
      type: 'root',
      children: [
        {
          type: 'details',
          syntax: 'html',
          attributes: {},
          children: [label('A'), paragraph('x')] as Details['children'],
        },
        {
          type: 'containerDirective',
          name: 'details',
          children: [label('B'), paragraph('y')] as ContainerDirective['children'],
        },
      ],
    }
    const { doc } = mdastToProseMirror(made)
    expect(doc.child(0).attrs['source']).toBeNull()
    expect(doc.child(1).attrs['attributes']).toEqual({})

    const [saved] = proseMirrorToMdast(doc).tree.children
    if (saved === undefined || !isDetails(saved)) throw new Error('expected a details')
    expect(saved).not.toHaveProperty('source')
  })

  it('saves a details whose summary node is missing as one with no summary', () => {
    const details = schema.nodes['details']
    if (details === undefined) throw new Error('schema')
    const doc = schema.nodes['doc']?.create(null, [
      details.create({ syntax: 'directive', attributes: {}, source: null }, []),
    ])
    if (doc === undefined) throw new Error('schema')
    const [saved] = proseMirrorToMdast(doc).tree.children
    expect(saved?.type).toBe('containerDirective')
    expect(saved && 'children' in saved ? saved.children : undefined).toEqual([])
  })
})
