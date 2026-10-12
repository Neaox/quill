import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { renderDocument, renderHtml } from './html.ts'
import { extractOutline, outlineWithin, walkOutline } from './outline.ts'

const render = (markdown: string): string => renderHtml(parseMarkdown(markdown))

/** A contents link; a heading's own permalink anchor is not one, it has no text of the heading. */
const LINK = (slug: string, text: string): string => `<a href="#user-content-${slug}">${text}</a>`

describe('outlineWithin', () => {
  const outline = extractOutline(parseMarkdown('# A\n\n## B\n\n### C\n\n#### D\n\n## E\n\n### F\n'))

  it('walks every heading in document order', () => {
    expect([...walkOutline(outline)].map((entry) => entry.text)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
    ])
  })

  it('keeps the headings between the two depths, nested', () => {
    const within = outlineWithin(outline, 2, 3)
    expect(within.map((entry) => entry.text)).toEqual(['B', 'E'])
    expect(within[0]?.children.map((entry) => entry.text)).toEqual(['C'])
  })

  it('lifts the children of a level that was dropped instead of losing them', () => {
    const within = outlineWithin(outline, 3, 4)
    expect(within.map((entry) => entry.text)).toEqual(['C', 'F'])
    expect(within[0]?.children.map((entry) => entry.text)).toEqual(['D'])
  })
})

describe('the table of contents block', () => {
  const document = '# Title\n\n::toc\n\n## One\n\n### Deeper\n\n#### Deepest\n\n## Two\n'

  it('lists the headings between its levels as nested links', () => {
    const html = render(document)
    expect(html).toContain('<nav class="toc" aria-label="Table of contents">')
    expect(html).toContain(
      '<ol><li><a href="#user-content-one">One</a><ol><li><a href="#user-content-deeper">Deeper</a></li></ol></li><li><a href="#user-content-two">Two</a></li></ol>',
    )
    expect(html).not.toContain(LINK('title', 'Title'))
    expect(html).not.toContain(LINK('deepest', 'Deepest'))
  })

  it('follows the levels it is told to list', () => {
    const html = render(document.replace('::toc', '::toc{min=1 max=2}'))
    expect(html).toContain(LINK('title', 'Title'))
    expect(html).not.toContain(LINK('deeper', 'Deeper'))
  })

  it('points at headings that exist in the body it is rendered with', () => {
    const { html, outline } = renderDocument(parseMarkdown(document))
    for (const entry of walkOutline(outline)) expect(html).toContain(`id="${entry.id}"`)
    expect(html).toContain('href="#user-content-two"')
  })

  it('renders nothing when there is nothing to list', () => {
    expect(render('::toc\n\nJust prose.\n')).toBe('<article><p>Just prose.</p></article>')
  })
})

describe('the child documents block', () => {
  it('is a slot carrying its depth, with its directive as the readable fallback', () => {
    const html = render('::children{depth=2}\n')
    expect(html).toContain(
      '<section class="live-block" data-live-block="children" aria-label="Live block: children" data-depth="2">',
    )
    expect(html).toContain('<p>::children{depth="2"}</p>')
  })

  it('carries the default depth when none is written', () => {
    expect(render('::children\n')).toContain('data-depth="1"')
  })

  it('never carries a depth the directive would not have read', () => {
    expect(render('::children{depth=99}\n')).toContain('data-depth="1"')
  })

  it('leaves other live blocks without parameters', () => {
    expect(render('::documents{limit=3}\n')).not.toContain('data-depth')
  })
})
