import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from '../render/html.ts'

const render = (markdown: string): string => renderHtml(parseMarkdown(markdown))

/** The body of the article the renderer wraps every document in. */
const body = (markdown: string): string =>
  render(markdown)
    .replace(/^<article>\n?/u, '')
    .replace(/\n?<\/article>$/u, '')

describe('drawing a details', () => {
  it('is the browser’s own details: a summary, then its body', () => {
    expect(body(':::details[Supported browsers]\n- Chrome\n:::\n')).toBe(
      [
        '<details class="details">',
        '<summary>Supported browsers</summary>',
        '<div class="details-body">',
        '<ul>',
        '<li>Chrome</li>',
        '</ul>',
        '</div>',
        '</details>',
      ].join('\n'),
    )
  })

  it('draws every syntax alike', () => {
    const directive = render(':::details[A **b**]{open}\nx\n:::\n')
    expect(render('<details open>\n<summary>A **b**</summary>\n\nx\n\n</details>\n')).toBe(
      directive,
    )
    expect(render('> [!note]+ A **b**\n> x\n')).toBe(
      directive.replace('class="details"', 'class="details callout callout-note"'),
    )
  })

  it('keeps the summary’s inline Markdown', () => {
    expect(render(':::details[Run `pnpm check` *first*]\nx\n:::\n')).toContain(
      '<summary>Run <code>pnpm check</code> <em>first</em></summary>',
    )
  })

  it('names a details without a summary by what it is', () => {
    expect(render(':::details\nx\n:::\n')).toContain('<summary>Details</summary>')
    expect(render(':::details{type=warning}\nx\n:::\n')).toContain('<summary>Warning</summary>')
    expect(render('> [!faq]-\n> x\n')).toContain('<summary>Info</summary>')
  })

  it('folds a callout: the details carries the callout’s classes', () => {
    expect(render(':::details[Careful]{type=caution}\nx\n:::\n')).toContain(
      '<details class="details callout callout-caution">',
    )
  })

  it('holds blocks of every kind, details included', () => {
    const html = render(
      [
        '::::details[Outer]',
        '## Inside',
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '```ts',
        'const a = 1',
        '```',
        '',
        ':::details[Inner]',
        'Deep.',
        ':::',
        '::::',
        '',
      ].join('\n'),
    )
    expect(html).toContain('<h2 id="user-content-inside" ')
    expect(html).toContain('<table>')
    expect(html).toContain('<code data-lang="ts">')
    expect(html.match(/<details class="details">/gu)).toHaveLength(2)
  })

  it('groups an accordion’s details by one name, each accordion its own', () => {
    const html = render(
      [
        '::::accordion',
        ':::details[A]',
        'a',
        ':::',
        '',
        ':::details[B]',
        'b',
        ':::',
        '::::',
        '',
        '::::accordion{name=faq}',
        ':::details[C]',
        'c',
        ':::',
        '::::',
        '',
        '::::accordion',
        '<details>',
        '<summary>D</summary>',
        '',
        'd',
        '',
        '</details>',
        '::::',
        '',
      ].join('\n'),
    )
    expect(html).toContain('<div class="accordion">')
    expect(html.match(/name="user-content-accordion-1"/gu)).toHaveLength(2)
    expect(html).toContain('name="user-content-faq"')
    expect(html).toContain('name="user-content-accordion-3"')
  })

  it('groups details that share a name of their own, and drops one in any other shape', () => {
    expect(render(':::details[A]{name=faq}\nx\n:::\n')).toContain(
      '<details class="details" name="user-content-faq">',
    )
    expect(render(':::details[A]{name="a b"}\nx\n:::\n')).toContain('<details class="details">')
  })
})

describe('details and the sanitiser', () => {
  it.each([
    [
      'an event handler on details',
      '<details ontoggle="alert(1)" open>\n<summary>A</summary>\n\nx\n\n</details>\n',
    ],
    [
      'an event handler on summary',
      '<details>\n<summary onclick="alert(1)">A</summary>\n\nx\n\n</details>\n',
    ],
    [
      'markup in the summary',
      '<details>\n<summary><img src=x onerror=alert(1)>A</summary>\n\nx\n\n</details>\n',
    ],
    ['a style', '<details style="display:block">\n<summary>A</summary>\n\nx\n\n</details>\n'],
  ])('escapes raw HTML with %s, as all raw HTML is', (_name, markdown) => {
    const html = render(markdown)
    expect(html).not.toMatch(/<details[\s>]/u)
    expect(html).not.toMatch(/<summary[\s>]/u)
    expect(html).toContain('&#x3C;details')
  })

  it('escapes a script inside a details’ body', () => {
    const html = render(
      '<details>\n<summary>A</summary>\n\n<script>alert(1)</script>\n\n</details>\n',
    )
    expect(html).toContain('<details class="details">')
    expect(html).not.toContain('<script')
    expect(html).toContain('&#x3C;script>alert(1)&#x3C;/script>')
  })

  it('admits nothing from a directive’s attributes but open, a name and a known kind', () => {
    const html = render(
      ':::details[A]{open onclick="alert(1)" style="x" class=evil name="x onmouseover=y" type=evil}\nx\n:::\n',
    )
    expect(html).toContain('<details class="details callout callout-note" open>')
    expect(html).not.toMatch(/onclick|onmouseover|style=|evil/u)
  })
})
