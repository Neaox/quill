import { sanitize } from 'hast-util-sanitize'
import type { Element, Root } from 'hast'
import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from '../render/html.ts'
import { sanitizeSchema } from '../render/sanitize-schema.ts'

const render = (markdown: string): string => renderHtml(parseMarkdown(markdown))

const GROUP = [
  ':::code-group',
  '```ts [TypeScript] title="client.ts"',
  'await fetch(url)',
  '```',
  '```py',
  'requests.get(url)',
  '```',
  '```sh title="request.sh"',
  'curl $URL',
  '```',
  ':::',
  '',
].join('\n')

describe('rendering code', () => {
  it('sets a block in its card', () => {
    expect(render('```ts\nconst a = 1\n```\n')).toBe(
      '<article><div class="code-block"><pre><code data-lang="ts">const a = 1</code></pre></div></article>',
    )
  })

  it('captions a block with the file its title names', () => {
    expect(render('```ts title="src/app.ts"\nconst a = 1\n```\n')).toBe(
      [
        '<article><figure class="code-block">',
        '<figcaption class="code-caption"><span class="code-title">src/app.ts</span></figcaption>',
        '<pre><code data-lang="ts">const a = 1</code></pre></figure></article>',
      ].join(''),
    )
  })

  it('draws every panel of a group, stacked, each under its name', () => {
    const html = render(GROUP)
    expect(html).toBe(
      [
        '<article><div class="code-group">',
        '<figure class="code-block"><figcaption class="code-caption">',
        '<span class="code-label">TypeScript</span><span class="code-title">client.ts</span>',
        '</figcaption><pre><code data-lang="ts">await fetch(url)</code></pre></figure>',
        '<figure class="code-block"><figcaption class="code-caption">',
        '<span class="code-label">Python</span>',
        '</figcaption><pre><code data-lang="py">requests.get(url)</code></pre></figure>',
        '<figure class="code-block"><figcaption class="code-caption">',
        '<span class="code-label">request.sh</span>',
        '</figcaption><pre><code data-lang="sh">curl $URL</code></pre></figure>',
        '</div></article>',
      ].join(''),
    )
  })

  it('says which choices a group shares, and only in a key’s own shape', () => {
    expect(render(GROUP.replace(':::code-group', ':::code-group{sync=pkg-manager}'))).toContain(
      '<div class="code-group" data-sync="pkg-manager">',
    )
    expect(
      render(GROUP.replace(':::code-group', ':::code-group{sync="x onload=alert(1)"}')),
    ).toContain('<div class="code-group">')
  })

  it('renders the other syntaxes the same way', () => {
    const vitepress = render(GROUP.replace(':::code-group', '::: code-group'))
    const fumadocs = render(
      ['```ts tab="TypeScript"', 'a', '```', '', '```py tab="Python"', 'b', '```', ''].join('\n'),
    )
    expect(vitepress).toBe(render(GROUP))
    expect(fumadocs).toContain('<span class="code-label">TypeScript</span>')
    expect(fumadocs).toContain('<span class="code-label">Python</span>')
  })

  it('leaves a diagram’s source in its slot, not a card', () => {
    expect(render('```mermaid\ngraph TD\n```\n')).toBe(
      '<article><div class="diagram" data-diagram="mermaid"><pre><code data-lang="mermaid">graph TD</code></pre></div></article>',
    )
  })

  it('degrades a code-group directive that holds prose to its children', () => {
    expect(render(':::code-group\nJust prose.\n:::\n')).toBe(
      '<article><p>Just prose.</p></article>',
    )
  })
})

/** One element's properties, after the document sanitiser has seen them. */
function sanitised(properties: Element['properties'], tagName = 'div'): Element['properties'] {
  const tree: Root = {
    type: 'root',
    children: [{ type: 'element', tagName, properties, children: [] }],
  }
  const result = sanitize(tree, sanitizeSchema)
  const first = result.type === 'root' ? result.children[0] : undefined
  return first?.type === 'element' ? first.properties : {}
}

describe('the code sanitiser grant', () => {
  it('admits a sync key and nothing shaped otherwise', () => {
    expect(sanitised({ className: ['code-group'], 'data-sync': 'pkg' })).toEqual({
      className: ['code-group'],
      'data-sync': 'pkg',
    })
    expect(sanitised({ 'data-sync': '"><script>' })).toEqual({})
    expect(sanitised({ 'data-sync': 'a b' })).toEqual({})
  })

  it('admits its class names only on the elements that carry them', () => {
    expect(sanitised({ className: ['code-caption', 'evil'] }, 'figcaption')).toEqual({
      className: ['code-caption'],
    })
    expect(sanitised({ className: ['code-block'], onclick: 'x' }, 'figure')).toEqual({
      className: ['code-block'],
    })
    expect(sanitised({ className: ['code-label', 'code-title'] }, 'span')).toEqual({
      className: ['code-label', 'code-title'],
    })
    expect(sanitised({ className: ['code-caption'] }, 'span')).toEqual({ className: [] })
  })

  it('escapes an author’s own markup that imitates a group', () => {
    const html = render('<div class="code-group" data-sync="x">hi</div>\n')
    expect(html).not.toContain('<div class="code-group"')
    expect(html).toContain('&#x3C;div class="code-group"')
  })
})
