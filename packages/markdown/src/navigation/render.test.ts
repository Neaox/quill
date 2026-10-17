import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { renderDocument, renderHtml } from '../render/html.ts'
import type { ChildPage } from './render.ts'
import {
  CHILD_PAGES_FALLBACK,
  childPagesQueries,
  fillChildPagesSlots,
  renderChildPages,
  renderTableOfContents,
} from './render.ts'

function render(markdown: string): string {
  return renderHtml(parseDocument(markdown).ast)
}

const HEADINGS = [
  '# Guide',
  '',
  '::toc',
  '',
  '## Install',
  '',
  '### Linux',
  '',
  '#### Debian',
  '',
  '## Setup',
  '',
  '## Setup',
  '',
  '## “Quotes” & <tags>',
  '',
].join('\n')

describe('a table of contents in the body', () => {
  it('is a nav named "Table of contents" listing levels 2 and 3, linked to each heading', () => {
    const html = render(HEADINGS)
    expect(html).toContain(
      [
        '<nav class="toc" data-style="bulleted" aria-label="Table of contents">',
        '<ul class="toc-list">',
        '<li><a href="#user-content-install">Install</a><ul class="toc-list"><li><a href="#user-content-linux">Linux</a></li></ul></li>',
        '<li><a href="#user-content-setup">Setup</a></li>',
        '<li><a href="#user-content-setup-1">Setup</a></li>',
        '<li><a href="#user-content-quotes--tags">“Quotes” &#x26; &#x3C;tags></a></li>',
        '</ul></nav>',
      ].join(''),
    )
  })

  it('links to exactly the ids the headings carry, repeated headings included', () => {
    const html = render(HEADINGS)
    const links = [...html.matchAll(/<nav class="toc"[\s\S]*?<\/nav>/g)]
      .flatMap((nav) => [...nav[0].matchAll(/href="#([^"]+)"/g)])
      .map((match) => match[1])
    const ids = [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((match) => match[1])
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(ids).toContain(link)
  })

  it('agrees with the outline the page’s own contents rail is built from', () => {
    const rendered = renderDocument(parseDocument(HEADINGS).ast)
    const install = rendered.outline[0]?.children[0]
    expect(install?.id).toBe('user-content-install')
    expect(rendered.html).toContain(`href="#${install?.id ?? ''}"`)
  })

  it('is titled, numbered and folded as the author asks', () => {
    const html = render(
      HEADINGS.replace('::toc', '::toc[On this page]{levels=2-4 style=numbered collapsed}'),
    )
    expect(html).toContain(
      '<nav class="toc" data-style="numbered" data-collapsed="" aria-labelledby="user-content-toc.1"><p class="toc-title" id="user-content-toc.1">On this page</p><ol class="toc-list">',
    )
    // The fold sits beside the link, never around it.
    expect(html).toContain(
      '<li><a href="#user-content-install">Install</a><details class="toc-fold"><summary><span class="sr-only">Subsections of Install</span></summary><ol class="toc-list"><li><a href="#user-content-linux">Linux</a><details class="toc-fold"><summary><span class="sr-only">Subsections of Linux</span></summary><ol class="toc-list"><li><a href="#user-content-debian">Debian</a></li></ol></details></li></ol></details></li>',
    )
  })

  it('numbers the titles of two contents blocks apart', () => {
    const html = render('::toc[One]\n\n## A\n\n::toc[Two]\n')
    expect(html).toContain('id="user-content-toc.1"')
    expect(html).toContain('id="user-content-toc.2"')
  })

  it('says so, quietly, when there are no headings at its levels', () => {
    expect(render('::toc{levels=5-6}\n\n## Only two\n')).toContain(
      '<p class="toc-empty">No headings at levels 5–6 yet.</p>',
    )
    expect(render('::toc{levels=4}\n')).toContain(
      '<p class="toc-empty">No level 4 headings yet.</p>',
    )
  })

  it('leaves a heading inside presenter notes out, as the reader does', () => {
    const html = render('::toc\n\n## Kept\n\n:::notes\n## Spoken\n:::\n')
    expect(html).toContain('href="#user-content-kept"')
    expect(html).not.toContain('Spoken')
  })

  it('updates when a heading changes, because it is drawn from the source each time', () => {
    expect(render('::toc\n\n## Before\n')).toContain('href="#user-content-before"')
    expect(render('::toc\n\n## After\n')).toContain('href="#user-content-after"')
  })

  it('renders the same twice (ADR-039)', () => {
    expect(render(HEADINGS)).toBe(render(HEADINGS))
  })
})

describe('a child pages slot in the body', () => {
  it('is a section carrying its type and key, with a fallback, named "Child pages"', () => {
    expect(render('::children\n')).toBe(
      `<article><section class="live-block child-pages" data-live-block="children" data-live-key="children?depth=1&#x26;sort=manual" aria-label="Child pages"><p class="child-pages-fallback">${CHILD_PAGES_FALLBACK}</p></section></article>`,
    )
  })

  it('is named by its title when it has one', () => {
    expect(render('::children[Guides]{depth=2 sort=title excerpts icons}\n')).toContain(
      '<section class="live-block child-pages" data-live-block="children" data-live-key="children?depth=2&#x26;sort=title&#x26;excerpts&#x26;icons" aria-labelledby="user-content-children.1"><p class="child-pages-title" id="user-content-children.1">Guides</p>',
    )
  })

  it('still degrades an unknown leaf directive to its source', () => {
    expect(render('::status{service=api}\n')).toContain('data-live-block="status"')
  })
})

const PAGES: readonly ChildPage[] = [
  {
    id: 'a',
    title: 'Install & run',
    href: '/d/a',
    draft: false,
    excerpt: 'How to <install>.',
    icon: '🚀',
    children: [
      {
        id: 'b',
        title: 'Linux',
        href: '/d/b',
        draft: true,
        excerpt: undefined,
        icon: undefined,
        children: [],
      },
    ],
  },
]

describe('filling a child pages slot', () => {
  it('draws the list with links, icons, excerpts and a draft badge, escaping every word', () => {
    expect(renderChildPages(PAGES, { depth: 2, sort: 'manual', excerpts: true, icons: true })).toBe(
      [
        '<ul class="child-pages-list"><li class="child-page">',
        '<a class="child-page-link" href="/d/a"><span class="child-page-icon" aria-hidden="true">🚀</span><span class="child-page-title">Install &#x26; run</span></a>',
        '<p class="child-page-excerpt">How to &#x3C;install>.</p>',
        '<ul class="child-pages-list"><li class="child-page">',
        '<a class="child-page-link" href="/d/b"><span class="child-page-icon" data-icon="page" aria-hidden="true"></span><span class="child-page-title">Linux</span></a>',
        '<span class="badge" data-tone="neutral">Draft</span>',
        '</li></ul></li></ul>',
      ].join(''),
    )
  })

  it('leaves out icons and excerpts unless asked', () => {
    const html = renderChildPages(PAGES, {
      depth: 2,
      sort: 'manual',
      excerpts: false,
      icons: false,
    })
    expect(html).not.toContain('child-page-icon')
    expect(html).not.toContain('child-page-excerpt')
  })

  it('says there are none yet', () => {
    expect(renderChildPages([], { depth: 1, sort: 'manual', excerpts: false, icons: false })).toBe(
      '<p class="child-pages-empty">No child pages yet</p>',
    )
  })

  it('finds each distinct query a body asks', () => {
    const html = render('::children\n\n::children[Again]\n\n::children{depth=2}\n')
    expect(childPagesQueries(html)).toEqual([
      { depth: 1, sort: 'manual', excerpts: false, icons: false },
      { depth: 2, sort: 'manual', excerpts: false, icons: false },
    ])
    expect(childPagesQueries(render('## Nothing\n'))).toEqual([])
  })

  it('fills every slot in place, keeping its title, asking each query once', () => {
    const html = render('# Title\n\n::children[In here]\n\n::children\n')
    const asked: unknown[] = []
    const filled = fillChildPagesSlots(html, (query) => {
      asked.push(query)
      return PAGES
    })
    expect(asked).toHaveLength(1)
    expect(filled).not.toContain('child-pages-fallback')
    expect(filled).toContain(
      '<p class="child-pages-title" id="user-content-children.1">In here</p><ul class="child-pages-list">',
    )
    // Two slots, each a list with one nested list.
    expect(filled.match(/class="child-pages-list"/g)).toHaveLength(4)
  })

  it('leaves a body with no slots exactly as it was', () => {
    const html = render('## Plain\n')
    expect(fillChildPagesSlots(html, () => PAGES)).toBe(html)
  })

  it('leaves a slot whose key it cannot read as its fallback', () => {
    const html =
      '<section class="live-block child-pages" data-live-block="children" data-live-key="children?depth=9"><p class="child-pages-fallback">x</p></section><section data-live-block="children"></section>'
    expect(fillChildPagesSlots(html, () => PAGES)).toBe(html)
  })
})

describe('renderTableOfContents', () => {
  it('draws the same markup the body does, for the editor’s preview', () => {
    const html = renderTableOfContents(
      { title: 'Contents', levels: { from: 2, to: 3 }, style: 'numbered', collapsed: false },
      [{ id: 'user-content-a', text: 'A & B', depth: 2, children: [] }],
    )
    expect(html).toBe(
      '<nav class="toc" data-style="numbered" aria-labelledby="toc.1"><p class="toc-title" id="toc.1">Contents</p><ol class="toc-list"><li><a href="#user-content-a">A &#x26; B</a></li></ol></nav>',
    )
  })
})
