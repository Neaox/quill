import { describe, expect, it } from 'vitest'
import type { Paragraph, PhrasingContent, Root, RootContent } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'

import { parseDocument } from '../pipeline/parse-document.ts'
import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { serializeDocument } from '../pipeline/serialize-document.ts'
import { mdastToProseMirror } from '../prosemirror/from-mdast.ts'
import { proseMirrorToMdast } from '../prosemirror/to-mdast.ts'
import { validateDirectives } from '../directives/registry.ts'
import type { Details, DetailsNode } from './details.ts'
import {
  ACCORDION,
  calloutKindOf,
  DETAILS,
  detailsModel,
  accordionDirective,
  detailsDirective,
  isDetails,
  isDetailsNode,
} from './details.ts'
import { readDetails } from './read.ts'
import type { ReadInline } from './read.ts'

/** Inline Markdown as the parser reads a summary: plain words only, for a hand-built tree. */
const words: ReadInline = (text) => [{ type: 'text', value: text }]

/** A details the editor made: no source form, a summary of `summary`, and one line of body. */
function fresh(
  syntax: Details['syntax'],
  attributes: Details['attributes'],
  summary: PhrasingContent[] = [],
): Details {
  const label: Paragraph[] =
    summary.length === 0
      ? []
      : [{ type: 'paragraph', data: { directiveLabel: true }, children: summary }]
  return {
    type: 'details',
    syntax,
    attributes,
    children: [...label, { type: 'paragraph', children: [{ type: 'text', value: 'x' }] }],
  }
}

/** Every details in a tree, in document order, whatever syntax it was written in. */
function detailsIn(tree: Root): DetailsNode[] {
  const found: DetailsNode[] = []
  const walk = (node: { readonly type: string; readonly children?: readonly unknown[] }): void => {
    if (isDetailsNode(node as RootContent)) found.push(node as DetailsNode)
    for (const child of node.children ?? []) walk(child as never)
  }
  walk(tree)
  return found
}

function only(markdown: string): DetailsNode {
  const [first] = detailsIn(parseMarkdown(markdown))
  if (first === undefined) throw new Error('no details read')
  return first
}

/** The summary's words and the body's text, which is what a reader sees of a details. */
function seen(node: DetailsNode): { summary: string; body: string[]; open: boolean } {
  const model = detailsModel(node)
  return {
    summary:
      model.summary?.children.map((child) => ('value' in child ? child.value : '')).join('') ?? '',
    body: model.body.map((block) => block.type),
    open: model.open,
  }
}

/** Markdown, through the editor and back, as a save from the editor writes it. */
function throughEditor(markdown: string): string {
  const parsed = parseDocument(markdown)
  const { doc } = mdastToProseMirror(parsed.ast)
  return serializeDocument({ frontMatter: parsed.frontMatter, ast: proseMirrorToMdast(doc).tree })
}

const DIRECTIVE = [':::details[Supported browsers]', '- Chrome', '- Firefox', ':::', ''].join('\n')

const GITHUB = [
  '<details>',
  '<summary>Supported browsers</summary>',
  '',
  '- Chrome',
  '- Firefox',
  '',
  '</details>',
  '',
].join('\n')

const OBSIDIAN = ['> [!tip]- Supported browsers', '> - Chrome', '> - Firefox', ''].join('\n')

describe('reading details', () => {
  it.each([
    ['the container directive', DIRECTIVE],
    ['GitHub’s raw HTML', GITHUB],
    ['an Obsidian foldable callout', OBSIDIAN],
  ])('reads %s as a closed section with its summary and body', (_name, markdown) => {
    expect(seen(only(markdown))).toEqual({
      summary: 'Supported browsers',
      body: ['list'],
      open: false,
    })
  })

  it('keeps the directive form a container directive, so every directive tool still works on it', () => {
    const node = only(DIRECTIVE)
    expect(node.type).toBe('containerDirective')
    expect(isDetails(node)).toBe(false)
  })

  it('reads the open attribute in each form', () => {
    expect(detailsModel(only(':::details[A]{open}\nx\n:::\n')).open).toBe(true)
    expect(detailsModel(only(':::details[A]{open=false}\nx\n:::\n')).open).toBe(false)
    expect(
      detailsModel(only('<details open>\n<summary>A</summary>\n\nx\n\n</details>\n')).open,
    ).toBe(true)
    expect(detailsModel(only('> [!note]+ A\n> x\n')).open).toBe(true)
  })

  it('reads the summary as inline Markdown', () => {
    const model = detailsModel(
      only('<details>\n<summary>Run `pnpm check` **first**</summary>\n\nx\n\n</details>\n'),
    )
    expect(model.summary?.children.map((child) => child.type)).toEqual([
      'text',
      'inlineCode',
      'text',
      'strong',
    ])
  })

  it('reads a summary on a line of its own, and none at all', () => {
    expect(seen(only('<details>\n\n<summary>Later</summary>\n\nx\n\n</details>\n')).summary).toBe(
      'Later',
    )
    expect(detailsModel(only('<details>\n\nx\n\n</details>\n')).summary).toBeUndefined()
  })

  it('nests, and closes several on one line', () => {
    const markdown = [
      '<details>',
      '<summary>Outer</summary>',
      '',
      '<details>',
      '<summary>Inner</summary>',
      '',
      'Deep.',
      '',
      '</details>',
      '</details>',
      '',
    ].join('\n')
    const [outer, inner] = detailsIn(parseMarkdown(markdown))
    expect(seen(outer ?? only(markdown)).summary).toBe('Outer')
    expect(seen(inner ?? only(markdown))).toEqual({
      summary: 'Inner',
      body: ['paragraph'],
      open: false,
    })
  })

  it('finds details inside lists, quotes and directives', () => {
    const markdown = [
      '- Step',
      '',
      '  <details>',
      '  <summary>Why</summary>',
      '',
      '  Because.',
      '',
      '  </details>',
      '',
      ':::callout',
      '> [!warning]- Careful',
      '> Mind the gap.',
      ':::',
      '',
    ].join('\n')
    expect(detailsIn(parseMarkdown(markdown)).map((node) => seen(node).summary)).toEqual([
      'Why',
      'Careful',
    ])
  })

  it('takes the callout kind from an Obsidian marker, mapping its other kinds onto Quill’s', () => {
    expect(calloutKindOf(only('> [!WARNING]- A\n> x\n'))).toBe('warning')
    expect(calloutKindOf(only('> [!faq]- A\n> x\n'))).toBe('info')
    expect(calloutKindOf(only('> [!bug]- A\n> x\n'))).toBe('caution')
    expect(calloutKindOf(only('> [!whatever]- A\n> x\n'))).toBe('note')
    expect(calloutKindOf(only(':::details[A]{type=tip}\nx\n:::\n'))).toBe('tip')
    expect(calloutKindOf(only(':::details[A]\nx\n:::\n'))).toBeUndefined()
  })

  it('gives an Obsidian callout without a title no summary, and a body that starts on its next line', () => {
    const node = only('> [!note]-\n> Body text.\n')
    expect(detailsModel(node).summary).toBeUndefined()
    expect(seen(node).body).toEqual(['paragraph'])
  })

  it('reads an accordion’s name, and a details’ own', () => {
    const markdown = '::::accordion{name=faq}\n:::details[A]\na\n:::\n::::\n'
    const [accordion] = parseMarkdown(markdown).children as ContainerDirective[]
    expect(accordion?.name).toBe(ACCORDION)
    expect(detailsModel(only(':::details[A]{name=faq}\na\n:::\n')).name).toBe('faq')
    expect(
      detailsModel(only(':::details[A]{name="no spaces allowed"}\na\n:::\n')).name,
    ).toBeUndefined()
  })
})

describe('raw HTML that is not exactly details', () => {
  it.each([
    [
      'an event handler',
      '<details ontoggle="alert(1)">\n<summary>A</summary>\n\nx\n\n</details>\n',
    ],
    ['any other attribute', '<details class="x">\n<summary>A</summary>\n\nx\n\n</details>\n'],
    [
      'an attribute on the summary',
      '<details>\n<summary onclick="alert(1)">A</summary>\n\nx\n\n</details>\n',
    ],
    [
      'markup in the summary',
      '<details>\n<summary><img src=x onerror=alert(1)></summary>\n\nx\n\n</details>\n',
    ],
    ['body text inside the HTML block', '<details>\n<summary>A</summary>\nx\n</details>\n'],
    ['no closing tag', '<details>\n<summary>A</summary>\n\nx\n'],
    ['a stray closing tag', 'x\n\n</details>\n'],
    ['a summary after the body', '<details>\n\nx\n\n<summary>A</summary>\n\n</details>\n'],
    ['an uppercase tag', '<DETAILS>\n<summary>A</summary>\n\nx\n\n</DETAILS>\n'],
    ['a summary that is a block', '<details>\n<summary># A</summary>\n\nx\n\n</details>\n'],
  ])('is left as raw HTML when it has %s', (_name, markdown) => {
    const tree = parseMarkdown(markdown)
    expect(detailsIn(tree)).toEqual([])
    expect(tree.children.some((node) => node.type === 'html')).toBe(true)
  })

  it('does not read an inline <details> tag in a paragraph', () => {
    expect(detailsIn(parseMarkdown('Text <details> more </details> text.\n'))).toEqual([])
  })

  it('leaves a blockquote that only looks like a foldable callout', () => {
    expect(detailsIn(parseMarkdown('> [!note] Not foldable\n> x\n'))).toEqual([])
    expect(detailsIn(parseMarkdown('> Just a quote [!note]-\n'))).toEqual([])
    expect(detailsIn(parseMarkdown('> [!note]- Title ending in a break\\\n> x\n'))).toEqual([])
  })
})

describe('writing details back', () => {
  it.each([
    ['the container directive', DIRECTIVE],
    ['GitHub’s raw HTML', GITHUB],
    ['an Obsidian foldable callout', OBSIDIAN],
    ['an open directive with a name', ':::details[A **b**]{open name=faq}\n\nPadded.\n\n:::\n'],
    [
      'HTML opened, with a space before its summary',
      '<details open>\n  <summary>A</summary>\n\nx\n\n</details>\n',
    ],
    ['HTML with a summary of its own', '<details>\n\n<summary>A</summary>\n\nx\n\n</details>\n'],
    ['HTML closing tight', '<details>\n<summary>A</summary>\n\nx\n</details>\n'],
    ['HTML with no summary', '<details>\n\nx\n\n</details>\n'],
    ['HTML with nothing in it', '<details>\n<summary>A</summary>\n\n</details>\n'],
    [
      'HTML straight after a paragraph',
      'Intro:\n<details>\n<summary>A</summary>\n\nx\n\n</details>\n',
    ],
    [
      'HTML nested and closed together',
      '<details>\n<summary>A</summary>\n\n<details>\n<summary>B</summary>\n\nx\n\n</details>\n</details>\n',
    ],
    [
      'HTML one after another',
      '<details>\n<summary>A</summary>\n\na\n\n</details>\n<details>\n<summary>B</summary>\n\nb\n\n</details>\n',
    ],
    [
      'HTML in a list item',
      '- Step\n\n  <details>\n  <summary>Why</summary>\n\n  Because.\n\n  </details>\n',
    ],
    [
      'an Obsidian callout opened, with a body of its own',
      '> [!NOTE]+ Title *x*\n>\n> Body.\n>\n> More.\n',
    ],
    ['an Obsidian callout without a title', '> [!faq]-\n> Body.\n'],
    ['an accordion', '::::accordion\n:::details[A]\na\n:::\n\n:::details[B]\nb\n:::\n::::\n'],
    [
      'a callout holding raw HTML details',
      ':::callout\n<details>\n<summary>A</summary>\n\nx\n\n</details>\n:::\n',
    ],
  ])('writes %s back byte for byte, through the editor too', (_name, markdown) => {
    expect(stringifyMdast(parseMarkdown(markdown))).toBe(markdown)
    expect(throughEditor(markdown)).toBe(markdown)
  })

  it('writes an HTML details back as HTML when its summary or its open state changes', () => {
    const tree = parseMarkdown(GITHUB)
    const [node] = detailsIn(tree)
    if (node === undefined || !isDetails(node)) throw new Error('expected an HTML details')
    const changed: Details = {
      ...node,
      attributes: { open: '' },
      children: [
        {
          type: 'paragraph',
          data: { directiveLabel: true },
          children: [{ type: 'text', value: 'Browsers' }],
        },
        ...node.children.slice(1),
      ],
    }
    expect(stringifyMdast({ type: 'root', children: [changed] })).toBe(
      '<details open>\n<summary>Browsers</summary>\n\n- Chrome\n- Firefox\n\n</details>\n',
    )
  })

  it('writes an Obsidian callout with its marker flipped when it is opened', () => {
    const [node] = detailsIn(parseMarkdown(OBSIDIAN))
    if (node === undefined || !isDetails(node)) throw new Error('expected a callout details')
    expect(
      stringifyMdast({
        type: 'root',
        children: [{ ...node, attributes: { type: 'tip', open: '' } }],
      }),
    ).toBe('> [!tip]+ Supported browsers\n> - Chrome\n> - Firefox\n')
  })

  it('writes a details its source form cannot hold as the directive', () => {
    const [html] = detailsIn(parseMarkdown(GITHUB))
    if (html === undefined || !isDetails(html)) throw new Error('expected an HTML details')
    const named: Details = { ...html, attributes: { name: 'faq' } }
    expect(stringifyMdast({ type: 'root', children: [named] })).toBe(
      ':::details[Supported browsers]{name="faq"}\n- Chrome\n- Firefox\n:::\n',
    )
    const tagged: Details = {
      ...html,
      children: [
        {
          type: 'paragraph',
          data: { directiveLabel: true },
          children: [{ type: 'text', value: 'a < b' }],
        },
        ...html.children.slice(1),
      ],
    }
    expect(stringifyMdast({ type: 'root', children: [tagged] })).toContain(':::details[a < b]')
  })

  it('writes a new HTML details in GitHub’s own layout', () => {
    const made: Details = {
      type: 'details',
      syntax: 'html',
      attributes: {},
      children: [
        {
          type: 'paragraph',
          data: { directiveLabel: true },
          children: [{ type: 'text', value: 'A' }],
        },
        { type: 'paragraph', children: [{ type: 'text', value: 'x' }] },
      ],
    }
    expect(stringifyMdast({ type: 'root', children: [made] })).toBe(
      '<details>\n<summary>A</summary>\n\nx\n\n</details>\n',
    )
  })

  it('never writes body text into the HTML block that opens it', () => {
    const [outer] = detailsIn(
      parseMarkdown(
        '<details>\n<summary>A</summary>\n<details>\n<summary>B</summary>\n\nx\n\n</details>\n</details>\n',
      ),
    )
    if (outer === undefined || !isDetails(outer)) throw new Error('expected an HTML details')
    const [summary] = outer.children
    const reshaped: Details = {
      ...outer,
      children: [
        ...(summary === undefined ? [] : [summary]),
        { type: 'paragraph', children: [{ type: 'text', value: 'y' }] },
      ],
    }
    const written = stringifyMdast({ type: 'root', children: [reshaped] })
    // The blank line after the opening is required; the one before the closing tag is not.
    expect(written).toBe('<details>\n<summary>A</summary>\n\ny\n</details>\n')
    expect(detailsIn(parseMarkdown(written))).toHaveLength(1)
  })
})

describe('details in the editor', () => {
  it.each([
    ['directive', DIRECTIVE],
    ['html', GITHUB],
    ['callout', OBSIDIAN],
  ])('opens a %s details as one node: its summary line, then its body', (syntax, markdown) => {
    const { doc, warnings } = mdastToProseMirror(parseMarkdown(markdown))
    const details = doc.firstChild
    expect(warnings).toEqual([])
    expect(details?.type.name).toBe('details')
    expect(details?.attrs['syntax']).toBe(syntax)
    expect(details?.firstChild?.type.name).toBe('detailsSummary')
    expect(details?.firstChild?.textContent).toBe('Supported browsers')
    expect(details?.child(1).type.name).toBe('bulletList')
  })

  it('holds an empty line for an empty body and an empty summary, and writes neither', () => {
    const { doc } = mdastToProseMirror(parseMarkdown(':::details\n:::\n'))
    expect(doc.firstChild?.childCount).toBe(2)
    expect(stringifyMdast(proseMirrorToMdast(doc).tree)).toBe(':::details\n:::\n')
  })
})

const root = (...children: RootContent[]): Root => ({ type: 'root', children })
const html = (value: string): RootContent => ({ type: 'html', value })
const text = (value: string): RootContent => ({
  type: 'paragraph',
  children: [{ type: 'text', value }],
})

describe('the edges of each form', () => {
  it('reads HTML tags in a tree the parser did not place, and leaves white space alone', () => {
    const read = readDetails(
      root(html('<details>\n<summary>A</summary>'), text('x'), html('</details>')),
      words,
    )
    expect(detailsIn(read).map((node) => seen(node).summary)).toEqual(['A'])
    const blank = root(html('  '), text('x'))
    expect(readDetails(blank, words)).toEqual(blank)
  })

  it('reads nothing at a level where a tag would hold what a details cannot', () => {
    const tree = root(html('<details>'), { type: 'text', value: 'loose' }, html('</details>'))
    expect(readDetails(tree, words)).toEqual(tree)
    const nested = root(
      html('<details>'),
      html('<details>'),
      { type: 'text', value: 'loose' },
      html('</details>\n</details>'),
    )
    expect(detailsIn(readDetails(nested, words))).toEqual([])
  })

  it('leaves a summary with no details to belong to, and a second summary, as HTML', () => {
    expect(detailsIn(parseMarkdown('<summary>A</summary>\n'))).toEqual([])
    expect(
      detailsIn(
        parseMarkdown('<details>\n<summary>A</summary>\n<summary>B</summary>\n\nx\n\n</details>\n'),
      ),
    ).toEqual([])
  })

  it('reads Obsidian titles that end in markup, or are only markup', () => {
    for (const markdown of ['> [!note]- *Title*\n> Body.\n', '> [!note]- Title\n> *Body*\n']) {
      expect(stringifyMdast(parseMarkdown(markdown))).toBe(markdown)
      expect(detailsIn(parseMarkdown(markdown))).toHaveLength(1)
    }
    // The space a title line ends on is no part of the title, and is not kept.
    expect(stringifyMdast(parseMarkdown('> [!note]- Title *x* \n> Body.\n'))).toBe(
      '> [!note]- Title *x*\n> Body.\n',
    )
    expect(detailsIn(parseMarkdown('> - [!note]- In a list\n'))).toEqual([])
    expect(detailsIn(parseMarkdown('> *[!note]-* Emphasised\n'))).toEqual([])
  })

  it('reads a foldable callout out of a quote the parser did not place', () => {
    const quote: RootContent = {
      type: 'blockquote',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: '[!tip]- A\nx' }] }],
    }
    const [node] = detailsIn(readDetails(root(quote), words))
    expect(node?.position).toBeUndefined()
    expect(node?.data).toBeUndefined()
  })

  it('keeps a details written tight under a paragraph tight, in both source forms', () => {
    for (const markdown of [
      'Intro:\n<details>\n<summary>A</summary>\n\nx\n\n</details>\n',
      'Intro:\n> [!tip]- A\n> x\n',
    ]) {
      expect(stringifyMdast(parseMarkdown(markdown))).toBe(markdown)
    }
  })

  it('never writes a callout tight under a quote it would join', () => {
    const tight: Details = {
      ...fresh('callout', { type: 'tip' }),
      data: { sourceForm: { blankLines: 0 } },
    }
    expect(
      stringifyMdast(root({ type: 'blockquote', children: [text('q')] } as RootContent, tight)),
    ).toBe('> q\n\n> [!tip]-\n>\n> x\n')
    expect(stringifyMdast(root(fresh('callout', { type: 'note' }), tight))).toBe(
      '> [!note]-\n>\n> x\n\n> [!tip]-\n>\n> x\n',
    )
    const named: Details = {
      ...fresh('html', { name: 'faq' }),
      data: { sourceForm: { blankLines: 0 } },
    }
    expect(stringifyMdast(root(text('p'), named))).toBe('p\n\n:::details{name="faq"}\nx\n:::\n')
  })

  it('writes new details in each form, and moves one to the directive when its summary will not fit', () => {
    expect(stringifyMdast(root(fresh('html', { open: '' })))).toBe(
      '<details open>\n\nx\n\n</details>\n',
    )
    expect(stringifyMdast(root({ ...fresh('html', {}), children: [] }))).toBe(
      '<details>\n\n</details>\n',
    )
    expect(
      stringifyMdast(
        root(fresh('callout', { type: 'tip', open: '' }, [{ type: 'text', value: 'A' }])),
      ),
    ).toBe('> [!tip]+ A\n>\n> x\n')
    expect(stringifyMdast(root(fresh('callout', { type: '9 bad' })))).toBe(
      ':::details{type="9 bad"}\nx\n:::\n',
    )
    const rich: PhrasingContent[] = [
      { type: 'text', value: 'Run ' },
      { type: 'inlineCode', value: 'check' },
      { type: 'emphasis', children: [{ type: 'text', value: 'now' }] },
      { type: 'strong', children: [{ type: 'text', value: '!' }] },
    ]
    expect(stringifyMdast(root(fresh('html', {}, rich)))).toBe(
      '<details>\n<summary>Run `check`*now***!**</summary>\n\nx\n\n</details>\n',
    )
    const linked: PhrasingContent[] = [
      { type: 'link', url: '/a', children: [{ type: 'text', value: 'A' }] },
    ]
    expect(stringifyMdast(root(fresh('html', {}, linked)))).toBe(
      '<details>\n<summary>[A](/a)</summary>\n\nx\n\n</details>\n',
    )
    const titled: PhrasingContent[] = [
      { type: 'link', url: '/a', title: 'T', children: [{ type: 'text', value: 'A' }] },
    ]
    expect(stringifyMdast(root(fresh('html', {}, titled)))).toBe(
      ':::details[[A](/a "T")]\nx\n:::\n',
    )
    const broken: PhrasingContent[] = [{ type: 'text', value: 'one\ntwo' }]
    expect(stringifyMdast(root(fresh('callout', { type: 'tip' }, broken)))).toContain(':::details[')
  })

  it('reads a directive with no attributes at all, and checks only what it claims', () => {
    const bare: ContainerDirective = { type: 'containerDirective', name: DETAILS, children: [] }
    expect(detailsModel(bare)).toEqual({
      summary: undefined,
      body: [],
      open: false,
      name: undefined,
      kind: undefined,
    })
    const leaf = { type: 'leafDirective' as const, name: DETAILS, children: [] }
    expect(detailsDirective.validate(leaf)).toEqual([])
    expect(accordionDirective.validate({ ...leaf, name: ACCORDION })).toEqual([])
    expect(accordionDirective.validate({ ...bare, name: 'callout' })).toEqual([])
  })

  it('takes a new details, and a bare directive, through the editor and back', () => {
    const tree = root(fresh('html', {}), {
      type: 'containerDirective',
      name: DETAILS,
      children: [],
    })
    const { doc, warnings } = mdastToProseMirror(tree)
    expect(warnings).toEqual([])
    expect(stringifyMdast(proseMirrorToMdast(doc).tree)).toBe(
      '<details>\n\nx\n\n</details>\n\n:::details\n:::\n',
    )
  })
})

describe('checking details', () => {
  it('warns about an unknown callout kind, a name it cannot use, and an accordion of other things', () => {
    const issues = validateDirectives(
      parseMarkdown(
        [
          ':::details[A]{type=shout name="a b"}',
          'x',
          ':::',
          '',
          '::::accordion',
          'Loose prose.',
          '',
          ':::details[B]',
          'b',
          ':::',
          '::::',
          '',
        ].join('\n'),
      ),
    )
    expect(issues.map((found) => found.path)).toEqual([
      `${DETAILS}[0].type`,
      `${DETAILS}[0].name`,
      `${ACCORDION}[1]`,
    ])
  })

  it('has nothing to say about well-formed details', () => {
    expect(
      validateDirectives(parseMarkdown(':::details[A]{open type=warning name=faq}\nx\n:::\n')),
    ).toEqual([])
    expect(
      validateDirectives(parseMarkdown('::::accordion\n:::details[A]\nx\n:::\n::::\n')),
    ).toEqual([])
  })
})
