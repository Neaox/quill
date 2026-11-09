import { describe, expect, it } from 'vitest'
import type { Root } from 'mdast'

import { parseDocument } from '../pipeline/parse-document.ts'
import { renderHtml } from './html.ts'
import { extractLinks } from './links.ts'
import type { DestinationResolution, ResolvedDestinations } from './resolve-destinations.ts'
import { resolveDestinations } from './resolve-destinations.ts'

const href = (address: string): DestinationResolution => ({ kind: 'href', href: address })
const TEXT: DestinationResolution = { kind: 'text' }

function resolved(markdown: string, destinations: ResolvedDestinations) {
  const ast = resolveDestinations(parseDocument(markdown).ast, destinations)
  return { html: renderHtml(ast), links: extractLinks(ast) }
}

describe('resolveDestinations', () => {
  it('readdresses a link, keeping its words and title', () => {
    const { html, links } = resolved('See [the **auth** ADR](../adr/0012.md#rotation "Auth").', {
      links: new Map([['../adr/0012.md#rotation', href('/d/abc#user-content-rotation')]]),
    })
    expect(html).toContain(
      '<a href="/d/abc#user-content-rotation" title="Auth">the <strong>auth</strong> ADR</a>',
    )
    expect(links.map(({ url }) => url)).toEqual(['/d/abc#user-content-rotation'])
  })

  it('reduces a link resolved to text to its words, and leaves it out of the links', () => {
    const { html, links } = resolved('See [the *missing* page](./gone.md) and [kept](./kept.md).', {
      links: new Map([['./gone.md', TEXT]]),
    })
    expect(html).toContain('See the <em>missing</em> page and <a href="./kept.md">kept</a>.')
    expect(links.map(({ url }) => url)).toEqual(['./kept.md'])
  })

  it('resolves a reference-style link through its definition, and leaves the definition be', () => {
    const markdown = [
      'Read [the guide][guide], [it again][guide] and [the gone one][gone].',
      '',
      '[guide]: ../guides/setup.md "Setup"',
      '[gone]: ./gone.md',
      '',
    ].join('\n')
    const { html, links } = resolved(markdown, {
      links: new Map([
        ['../guides/setup.md', href('/d/setup')],
        ['./gone.md', TEXT],
      ]),
    })
    expect(html).toContain('<a href="/d/setup" title="Setup">the guide</a>')
    expect(html).toContain('<a href="/d/setup" title="Setup">it again</a>')
    expect(html).toContain('and the gone one.')
    expect(links.map(({ url }) => url)).toEqual(['/d/setup', '/d/setup'])
  })

  it('leaves a reference whose definition is unresolved as it was', () => {
    const markdown = 'A [kept][kept] and ![kept][kept].\n\n[kept]: ./kept.md\n'
    const { html } = resolved(markdown, {
      links: new Map([['./other.md', TEXT]]),
      images: new Map([['./other.md', TEXT]]),
    })
    expect(html).toContain('A <a href="./kept.md">kept</a> and <img src="./kept.md" alt="kept">.')
  })

  it('leaves a reference with no definition as it was', () => {
    // The parser only makes a reference of a label something defines; a tree built otherwise may not.
    const ast: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'linkReference',
              identifier: 'nowhere',
              label: 'nowhere',
              referenceType: 'full',
              children: [{ type: 'text', value: 'words' }],
            },
            {
              type: 'imageReference',
              identifier: 'nowhere',
              label: 'nowhere',
              referenceType: 'full',
              alt: 'alt',
            },
          ],
        },
      ],
    }
    const destinations = { links: new Map([['x', TEXT]]), images: new Map([['x', TEXT]]) }
    expect(resolveDestinations(structuredClone(ast), destinations)).toEqual(ast)
  })

  it('readdresses an image, or shows its alternative text', () => {
    const markdown = [
      '![Flow](../diagrams/flow.png) ![Gone](./gone.png) ![](./blank.png) ![Kept](./kept.png)',
      '',
      '![Ref][flow] ![Ref gone][gone] ![Ref missing][nowhere]',
      '',
      '[flow]: ../diagrams/flow.png "The flow"',
      '[gone]: ./gone.png',
      '',
    ].join('\n')
    const { html, links } = resolved(markdown, {
      images: new Map([
        ['../diagrams/flow.png', href('/attachments/abc')],
        ['./gone.png', TEXT],
        ['./blank.png', TEXT],
      ]),
    })
    expect(html).toContain('<img src="/attachments/abc" alt="Flow">')
    expect(html).toContain('<img src="/attachments/abc" alt="Ref" title="The flow">')
    expect(html).toContain('Gone')
    expect(html).toContain('Ref gone')
    expect(html).not.toContain('gone.png')
    expect(html).not.toContain('blank.png')
    expect(html).toContain('<img src="./kept.png" alt="Kept">')
    expect(links.map(({ url }) => url)).toEqual([
      '/attachments/abc',
      './kept.png',
      '/attachments/abc',
    ])
  })

  it('resolves a link and an image sharing a definition each by its own kind', () => {
    const markdown = '[See it][d] ![It][d]\n\n[d]: ./flow.png\n'
    const { html } = resolved(markdown, {
      links: new Map([['./flow.png', href('https://forge.example/flow.png')]]),
      images: new Map([['./flow.png', href('/attachments/flow')]]),
    })
    expect(html).toContain('<a href="https://forge.example/flow.png"')
    expect(html).toContain('<img src="/attachments/flow" alt="It">')
  })

  it('returns the tree untouched when nothing resolved', () => {
    const ast = parseDocument('[a](./a.md)').ast
    expect(resolveDestinations(ast, {})).toBe(ast)
    expect(renderHtml(resolveDestinations(ast, { links: new Map() }))).toContain('href="./a.md"')
  })
})
