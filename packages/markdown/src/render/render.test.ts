import { describe, expect, it } from 'vitest'
import type { Root } from 'mdast'

import { stripAuthoringBlocks } from '../directives/strip-authoring-blocks.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { renderDocument, renderHtml } from './html.ts'
import { extractLinks } from './links.ts'
import { extractOutline } from './outline.ts'
import { createSlugger } from './slug.ts'
import { extractText } from './text.ts'

const render = (markdown: string, options?: Parameters<typeof renderHtml>[1]): string =>
  renderHtml(parseMarkdown(markdown), options)

describe('createSlugger', () => {
  it('produces readable identifiers', () => {
    const slug = createSlugger()

    expect(slug('Block layout widths')).toBe('block-layout-widths')
    expect(slug('What about `code`, and punctuation?')).toBe('what-about-code-and-punctuation')
  })

  it('deduplicates within a document', () => {
    const slug = createSlugger()

    expect(slug('Context')).toBe('context')
    expect(slug('Context')).toBe('context-1')
    expect(slug('Context')).toBe('context-2')
  })

  it('falls back when a heading has no sluggable characters', () => {
    expect(createSlugger()('!!!')).toBe('section')
  })
})

describe('renderHtml', () => {
  it('wraps the document in an article', () => {
    expect(render('Text.\n')).toBe('<article><p>Text.</p></article>')
  })

  it('gives every heading a prefixed id and an anchor that resolves to it', () => {
    const html = render('# One\n\n## One\n')

    // The prefix is what stops an author's heading minting `id="main"` or a
    // global the application relies on; the anchor carries it too, so the
    // permalink still lands on its own heading.
    expect(html).toContain(
      '<h1 id="user-content-one">One<a class="heading-anchor" href="#user-content-one"',
    )
    expect(html).toContain('<h2 id="user-content-one-1">')
    expect(html).toContain('href="#user-content-one-1"')
    expect(html).toContain('aria-label="Permalink: One"')
  })

  it('renders tables with a head, column scopes and alignment classes', () => {
    const html = render('| a | b |\n| :- | --: |\n| 1 | 2 |\n')

    expect(html).toContain('<thead>')
    expect(html).toContain('<th scope="col" class="align-left">a</th>')
    expect(html).toContain('<th scope="col" class="align-right">b</th>')
    expect(html).toContain('<tbody>')
    expect(html).toContain('<td class="align-left">1</td>')
  })

  it('renders a header-only table without an empty body', () => {
    const html = render('| a |\n| - |\n')

    expect(html).toContain('<thead>')
    expect(html).not.toContain('<tbody>')
    expect(html).toContain('<th scope="col">a</th>')
  })

  it('renders a table the editor built, which records no alignment', () => {
    const ast: Root = {
      type: 'root',
      children: [
        {
          type: 'table',
          align: null,
          children: [{ type: 'tableRow', children: [{ type: 'tableCell', children: [] }] }],
        },
      ],
    }

    expect(renderHtml(ast)).toContain('<th scope="col"></th>')
  })

  it('renders a captioned image as a figure', () => {
    const html = render('![A landscape](landscape.svg "System landscape")\n')

    expect(html).toContain('<figure><img src="landscape.svg" alt="A landscape">')
    expect(html).toContain('<figcaption>System landscape</figcaption>')
  })

  it('renders an image with no caption inline', () => {
    const html = render('Text with ![A logo](logo.svg) inside.\n')

    expect(html).toContain('<img src="logo.svg" alt="A logo">')
    expect(html).not.toContain('<figure>')
  })

  it('gives an image without alternative text an empty alt rather than none', () => {
    const ast: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'image', url: 'x.png' }] }],
    }

    expect(renderHtml(ast)).toContain('<img src="x.png" alt="">')
  })

  it('renders a code block as one text node, with the language', () => {
    const html = render('```ts\nconst a = 1\n```\n')

    expect(html).toBe('<article><pre><code data-lang="ts">const a = 1</code></pre></article>')
  })

  it('carries packed token ranges when a highlighter is supplied', () => {
    const html = render('```ts\nconst a = 1\n```\n\n```\nplain\n```\n', {
      highlighter: (text, language) => `${language}:${text.length}`,
    })

    expect(html).toContain('<code data-lang="ts" data-tokens="ts:11">')
    expect(html).toContain('<pre><code>plain</code></pre>')
  })

  it('omits token ranges when the highlighter declines the block', () => {
    const html = render('```ts\nconst a = 1\n```\n', { highlighter: () => null })

    expect(html).toContain('<code data-lang="ts">')
    expect(html).not.toContain('data-tokens')
  })

  it('names the language the tokenizer resolved, not the fence tag', () => {
    // `data-lang` and `data-tokens` have to agree: the ranges were produced for
    // the resolved grammar, so that is what the block claims to be.
    const html = render('```TS\nconst a = 1\n```\n', {
      highlighter: () => ({ language: 'typescript', tokens: 'packed' }),
    })

    expect(html).toContain('<code data-lang="typescript" data-tokens="packed">')
  })

  it('refuses a fence tag that does not read as a language name', () => {
    const fence = 'x'.repeat(40)
    const html = render(`\`\`\`${fence}\nbody\n\`\`\`\n\n\`\`\`<script>\nbody\n\`\`\`\n`, {
      highlighter: () => null,
    })

    expect(html).not.toContain('data-lang')
    expect(html).not.toContain(fence)
    // A real fence tag still comes through as written.
    expect(render('```c#\nx\n```\n')).toContain('data-lang="c#"')
  })

  it('renders task lists with disabled checkboxes', () => {
    const html = render('- [ ] todo\n- [x] done\n')

    expect(html).toContain('<input type="checkbox" disabled>')
    expect(html).toContain('<input type="checkbox" checked disabled>')
  })

  it('renders a callout as a labelled aside', () => {
    const html = render(':::callout{type=warning}\nCareful.\n:::\n')

    expect(html).toContain(
      '<aside class="callout callout-warning" role="note" aria-label="Warning">',
    )
  })

  it('uses a callout label as its accessible name', () => {
    const html = render(':::callout[Before you begin]{type=note}\n\nBody.\n:::\n')

    expect(html).toContain('aria-label="Before you begin"')
    expect(html).toContain('<p class="callout-label">Before you begin</p>')
    expect(html).toContain('<p>Body.</p>')
  })

  it('renders nothing for presenter notes, so a reader never meets them', () => {
    const html = render(
      'Shown.\n\n:::notes\n## Not a section\n\nSaid aloud, with a [link](https://example.com).\n:::\n',
    )
    expect(html).toContain('Shown.')
    expect(html).not.toContain('Said aloud')
    expect(html).not.toContain('Not a section')
    expect(html).not.toContain('presenter-notes')
    expect(html).not.toContain('example.com')
  })

  it('renders layout wrappers as layout divs', () => {
    expect(render(':::wide\nWide.\n:::\n')).toContain('<div class="layout-wide">')
    expect(render(':::full\nFull.\n:::\n')).toContain('<div class="layout-full">')
  })

  it('renders the template blocks an editor preview needs to show', () => {
    expect(render(':::guidance\nHint.\n:::\n')).toContain('class="guidance" role="note"')
    expect(render(':::placeholder\nPrompt.\n:::\n')).toContain('<div class="placeholder">')
    expect(render('A :placeholder[prompt] here.\n')).toContain('<span class="placeholder">')
    expect(render(':::optional{title=Alternatives}\nx\n:::\n')).toContain(
      '<section class="optional" aria-label="Optional section: Alternatives">',
    )
    expect(render(':::optional\nx\n:::\n')).toContain('aria-label="Optional section: "')
    expect(render(':::repeat{title=Alternative}\nx\n:::\n')).toContain(
      '<section class="repeat" aria-label="Repeatable section: Alternative">',
    )
    expect(render(':::repeat\nx\n:::\n')).toContain('aria-label="Repeatable section: "')
  })

  it('renders a keyboard directive as a kbd element', () => {
    expect(render('Press :kbd[Ctrl+C] to stop.\n')).toContain('<kbd>Ctrl+C</kbd>')
  })

  it('drops the wrapper of an unknown container directive, keeping the content', () => {
    expect(render(':::timeline{orientation=vertical}\nStill here.\n:::\n')).toBe(
      '<article><p>Still here.</p></article>',
    )
  })

  it('renders an unknown leaf directive as a slot holding its readable form', () => {
    expect(render('::future-embed{src=x}\n')).toBe(
      [
        '<article><section class="live-block" data-live-block="future-embed"',
        ' aria-label="Live block: future-embed">\n<p>::future-embed{src="x"}</p>\n',
        '</section></article>',
      ].join(''),
    )
  })

  it('writes an unknown text directive back as the source the author typed', () => {
    // The whole point: `:` is a directive marker, so prose that merely contains
    // one must not lose the characters around it.
    expect(render('Ratio 3:2 and 10:30.\n')).toBe('<article><p>Ratio 3:2 and 10:30.</p></article>')
    expect(render('A data:image/png payload.\n')).toBe(
      '<article><p>A data:image/png payload.</p></article>',
    )
    expect(render('A :mystery[value]{k=v} inline.\n')).toBe(
      '<article><p>A :mystery[value]{k="v"} inline.</p></article>',
    )
    expect(render('A :mystery[**bold**] inline.\n')).toContain(':mystery[<strong>bold</strong>]')
  })

  it('writes a directive id and class attribute back in their shorthand', () => {
    expect(render('A :mystery{#x .a.b} inline.\n')).toContain(':mystery{#x .a.b}')
    expect(render('A :mystery{flag} inline.\n')).toContain(':mystery{flag}')
  })

  it('writes back a directive the editor built, which records no attributes', () => {
    const ast: Root = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'textDirective', name: 'mystery', children: [] }] },
        { type: 'leafDirective', name: 'embed', children: [] },
      ],
    }

    expect(renderHtml(ast)).toContain('<p>:mystery</p>')
    expect(renderHtml(ast)).toContain('<p>::embed</p>')
  })

  it('does not render front matter as content', () => {
    expect(render('---\ntitle: One\n---\n\nBody.\n')).toBe('<article><p>Body.</p></article>')
  })

  it('renders dates from front matter as time elements', () => {
    const html = render('Body.\n', {
      frontMatter: {
        title: 'One',
        order: 2,
        published: '2026-01-31',
        review: { interval: '365d', lastReviewed: '2026-02-01T09:00:00Z' },
        owners: ['platform'],
      },
    })

    expect(html).toContain('<header class="document-meta">')
    expect(html).toContain('<dt>published</dt><dd><time datetime="2026-01-31">')
    expect(html).toContain('<dt>review.lastReviewed</dt>')
    expect(html).not.toContain('365d')
  })

  it('omits the header when no front matter carries a date', () => {
    expect(render('Body.\n', { frontMatter: { title: 'One' } })).not.toContain('<header')
  })

  it('adds rel="noopener noreferrer" to an external link but not a relative one', () => {
    const html = render(
      '[external](https://example.com) and [relative](./other.md) and [mail](mailto:a@example.com).\n',
    )

    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer">external</a>')
    expect(html).toContain('<a href="./other.md">relative</a>')
    // `mailto:` has a scheme, so `isExternal` (shared with `extractLinks`) counts
    // it as external too; opening the reader's mail client in a fresh context is
    // harmless, and treating every scheme uniformly is simpler than special-casing
    // this one.
    expect(html).toContain('<a href="mailto:a@example.com" rel="noopener noreferrer">mail</a>')
  })

  it('escapes raw HTML to visible text instead of letting it through (ADR-011)', () => {
    const html = render('<div align="center">Hi</div>\n')

    expect(html).not.toContain('<div')
    expect(html).toBe('<article>&#x3C;div align="center">Hi&#x3C;/div></article>')
  })
})

describe('extractOutline', () => {
  it('nests headings and matches the rendered identifiers', () => {
    const ast = parseMarkdown('# One\n\n## Two\n\n### Three\n\n## Two\n\n# Four\n')
    const outline = extractOutline(ast)

    expect(outline.map((entry) => entry.text)).toEqual(['One', 'Four'])
    expect(outline[0]?.children.map((entry) => entry.id)).toEqual([
      'user-content-two',
      'user-content-two-1',
    ])
    expect(outline[0]?.children[0]?.children[0]?.text).toBe('Three')
    expect(renderHtml(ast)).toContain('id="user-content-two-1"')
  })

  it('copes with a document that starts at a deeper level', () => {
    const outline = extractOutline(parseMarkdown('### Deep\n\n# Shallow\n'))

    expect(outline.map((entry) => entry.depth)).toEqual([3, 1])
  })

  it('returns nothing for a document with no headings', () => {
    expect(extractOutline(parseMarkdown('Text.\n'))).toEqual([])
  })
})

describe('renderDocument', () => {
  it('gives an outline whose ids are in the html it returns', () => {
    const { html, outline } = renderDocument(parseMarkdown('# One\n\n## Two\n\n## Two\n'))

    for (const id of outline.flatMap((entry) => entry.children.map((child) => child.id))) {
      expect(html).toContain(`id="${id}"`)
      expect(html).toContain(`href="#${id}"`)
    }
    expect(outline[0]?.children.map((entry) => entry.id)).toEqual([
      'user-content-two',
      'user-content-two-1',
    ])
  })

  it('cannot drift, because both halves read the same tree', () => {
    // The failure this exists to prevent: a caller that strips authoring blocks
    // for the published body and then takes the outline from the unstripped
    // draft gets `two-1` in one and `two` in the other.
    const draft = parseMarkdown(':::optional{title="Skipped"}\n## Two\n:::\n\n# One\n\n## Two\n')
    const { ast } = stripAuthoringBlocks(draft)
    const { html, outline } = renderDocument(ast)

    expect(outline[0]?.children[0]?.id).toBe('user-content-two')
    expect(html).toContain('id="user-content-two"')
    expect(html).not.toContain('user-content-two-1')
  })
})

describe('extractText', () => {
  it('separates the title, the headings and the body', () => {
    const result = extractText(
      parseMarkdown('---\ntitle: meta\n---\n\n# One\n\n## Two\n\nBody text.\n\n```ts\ncode\n```\n'),
    )

    expect(result.title).toBe('One')
    expect(result.headings).toEqual(['One', 'Two'])
    expect(result.body).toBe('Body text.\ncode')
    expect(result.body).not.toContain('meta')
  })

  it('indexes table cells and list items', () => {
    const result = extractText(parseMarkdown('- item\n\n| a |\n| - |\n| cell |\n'))

    expect(result.body).toContain('item')
    expect(result.body).toContain('cell')
  })

  it('excludes authoring scaffolding', () => {
    const result = extractText(
      parseMarkdown(':::guidance\nAdvice.\n:::\n\nKept.\n\n:::notes\nAside.\n:::\n'),
    )

    expect(result.body).toBe('Kept.')
  })

  it('falls back to the first heading when there is no level one', () => {
    expect(extractText(parseMarkdown('## Two\n\n### Three\n')).title).toBe('Two')
  })

  it('has no title when there are no headings', () => {
    expect(extractText(parseMarkdown('Text.\n')).title).toBeUndefined()
  })
})

describe('extractLinks', () => {
  it('finds links and images, inline and by reference', () => {
    const links = extractLinks(
      parseMarkdown(
        [
          'An [external](https://example.com "Home") link and a [relative](./other.md) one.',
          '',
          '![Logo](logo.svg "Our logo") and ![Badge][badge].',
          '',
          'A [reference][home] link.',
          '',
          '[home]: https://example.com',
          '[badge]: badge.svg "Build"',
          '',
        ].join('\n'),
      ),
    )

    expect(links).toContainEqual({
      kind: 'link',
      url: 'https://example.com',
      title: 'Home',
      text: 'external',
      external: true,
    })
    expect(links).toContainEqual({
      kind: 'link',
      url: './other.md',
      title: undefined,
      text: 'relative',
      external: false,
    })
    expect(links).toContainEqual({
      kind: 'image',
      url: 'badge.svg',
      title: 'Build',
      text: 'Badge',
      external: false,
    })
  })

  it('reports a reference with no definition as having no url', () => {
    const ast: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'linkReference',
              identifier: 'missing',
              referenceType: 'shortcut',
              children: [{ type: 'text', value: 'dangling' }],
            },
            { type: 'imageReference', identifier: 'gone', referenceType: 'shortcut', alt: 'x' },
          ],
        },
      ],
    }

    expect(extractLinks(ast).map((found) => found.url)).toEqual(['', ''])
  })

  it('treats a protocol-relative url as external', () => {
    const [found] = extractLinks(parseMarkdown('[cdn](//cdn.example.com/x.js)\n'))

    expect(found?.external).toBe(true)
  })

  it('reads an image with no alternative text, by reference or inline', () => {
    const ast: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'imageReference', identifier: 'a', referenceType: 'shortcut' },
            { type: 'image', url: 'b.png' },
          ],
        },
        { type: 'definition', identifier: 'a', url: 'a.png' },
      ],
    }

    expect(extractLinks(ast)).toEqual([
      { kind: 'image', url: 'a.png', title: undefined, text: '', external: false },
      { kind: 'image', url: 'b.png', title: undefined, text: '', external: false },
    ])
  })

  it('returns nothing for a document with no links', () => {
    expect(extractLinks(parseMarkdown('Text.\n'))).toEqual([])
  })
})

describe('presenter notes', () => {
  const source = [
    '# Rollout',
    '',
    'Shown to the room.',
    '',
    ':::notes',
    '## Not a section',
    '',
    'Said aloud, see [the runbook](https://example.com/runbook).',
    ':::',
    '',
    '## Next steps',
  ].join('\n')

  it('are kept out of the outline, the links, and the text', () => {
    const ast = parseMarkdown(source)

    expect(extractOutline(ast).map((entry) => entry.text)).toEqual(['Rollout'])
    expect(extractOutline(ast)[0]?.children.map((entry) => entry.text)).toEqual(['Next steps'])
    expect(extractLinks(ast)).toEqual([])
    expect(extractText(ast).headings).toEqual(['Rollout', 'Next steps'])
    expect(extractText(ast).body).toBe('Shown to the room.')
  })

  it('leave heading ids in the outline matching the rendered body', () => {
    const rendered = renderDocument(parseMarkdown(source))
    for (const entry of [...rendered.outline, ...rendered.outline.flatMap((e) => e.children)]) {
      expect(rendered.html).toContain(`id="${entry.id}"`)
    }
  })
})
