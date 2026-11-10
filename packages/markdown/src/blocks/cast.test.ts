import { describe, expect, it } from 'vitest'

import type { CustomEmoji } from '../emoji/emoji.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { renderDocument } from '../render/html.ts'

const EMOJI: ReadonlyMap<string, CustomEmoji> = new Map(
  ['person', 'rookwood', 'northgate', 'eastfield'].map((name) => [
    name,
    { src: `/api/emoji/${name}.0123456789abcdef.svg`, width: 16, height: 16 },
  ]),
)

const icon = (name: string): string =>
  `<img class="emoji" src="/api/emoji/${name}.0123456789abcdef.svg" alt="" width="20" height="20">`

const rendered = (markdown: string) => renderDocument(parseMarkdown(markdown), { emoji: EMOJI })

const html = (markdown: string): string => rendered(markdown).html

const member = (node: string, name: string, words: string): string =>
  `<li>${node}<span class="qb-cast-text"><strong>${name}</strong>${words}</span></li>`

describe(':::cast', () => {
  it('draws each member as a chip: its emoji in a node, its name, and what it does', () => {
    expect(
      html(
        [
          ':::cast{outside="Northgate, Eastfield"}',
          '',
          '- :person: **Iris Vale** · Runs the riverside branch',
          '- :rookwood: **Rookwood** · API, gateway, worker and engine',
          '- :northgate: **Northgate** · Tells Rookwood about each hold',
          '- :eastfield: **Eastfield** · Waits for Rookwood to ask',
          '',
          ':::',
          '',
        ].join('\n'),
      ),
    ).toBe(
      [
        '<article><ul class="qb qb-cast">',
        member(
          `<span class="qb-cast-node">${icon('person')}</span>`,
          'Iris Vale',
          'Runs the riverside branch',
        ),
        member(
          `<span class="qb-cast-node">${icon('rookwood')}</span>`,
          'Rookwood',
          'API, gateway, worker and engine',
        ),
        member(
          `<span class="qb-cast-node" data-qb-tone="outside">${icon('northgate')}</span>`,
          'Northgate',
          'Tells Rookwood about each hold',
        ),
        member(
          `<span class="qb-cast-node" data-qb-tone="outside">${icon('eastfield')}</span>`,
          'Eastfield',
          'Waits for Rookwood to ask',
        ),
        '</ul></article>',
      ].join(''),
    )
  })

  it('sets narrower chips with a bare `narrow`', () => {
    expect(html(':::cast{narrow}\n- :person: **A** · B\n:::\n')).toContain(
      '<ul class="qb qb-cast qb-cast-narrow">',
    )
    expect(html(':::cast{narrow=false}\n- :person: **A** · B\n:::\n')).toContain(
      '<ul class="qb qb-cast">',
    )
  })

  it('reads a member loosely: the ` · ` is optional, the emoji too', () => {
    expect(html(':::cast\n- **Iris** Runs a branch\n- :person: Just words\n:::\n')).toBe(
      [
        '<article><ul class="qb qb-cast">',
        member('<span class="qb-cast-node"></span>', 'Iris', 'Runs a branch'),
        // The emoji is in the words, so it is named, as any emoji in prose is.
        '<li><span class="qb-cast-node"></span><span class="qb-cast-text"><img class="emoji" src="/api/emoji/person.0123456789abcdef.svg" alt="person" title=":person:" width="20" height="20"> Just words</span></li>',
        '</ul></article>',
      ].join(''),
    )
  })

  it('matches `outside` by the member’s name as words, and joins a wrapped item’s lines', () => {
    expect(
      html(
        ':::cast{outside="The **reader**, Eastfield"}\n- :person: **The *reader***\n  who borrows\n:::\n',
      ),
    ).toContain(
      `<span class="qb-cast-node">${icon('person')}</span><span class="qb-cast-text"><strong>The <em>reader</em></strong>who borrows</span>`,
    )
    expect(html(':::cast{outside="The reader"}\n- :person: **The *reader***\n:::\n')).toContain(
      'data-qb-tone="outside"',
    )
  })

  it('draws a member’s words as inline Markdown, and a name’s too', () => {
    expect(
      html(':::cast\n- :rookwood: **`api`** · Reads [the docs](https://x.test)\n:::\n'),
    ).toContain(
      '<strong><code>api</code></strong>Reads <a href="https://x.test" rel="noopener noreferrer">the docs</a>',
    )
  })

  it('is a list and nothing else, and says so through its frame', () => {
    const result = rendered(':::cast\nIris and Northgate.\n:::\n')
    expect(result.html).toContain(
      'role="group" aria-label="cast holds a bulleted list of members, and nothing else: cast"',
    )
    expect(result.html).toContain('<p>Iris and Northgate.</p>')
    expect(result.blockIssues).toEqual([
      {
        block: 'cast',
        message: 'cast holds a bulleted list of members, and nothing else',
        line: 1,
      },
    ])
  })

  it('refuses a numbered list, and a member of more than one line', () => {
    expect(rendered(':::cast\n1. **A**\n:::\n').blockIssues[0]?.message).toBe(
      'cast holds a bulleted list of members',
    )
    expect(rendered(':::cast\n- **A**\n\n  More.\n:::\n').blockIssues[0]?.message).toBe(
      'each item of cast is one line',
    )
    expect(rendered(':::cast\n:::\n').blockIssues[0]?.message).toBe(
      'cast holds a bulleted list of members, and nothing else',
    )
  })

  it('reports a prop it does not take, and still draws', () => {
    const result = rendered(':::cast{columns=2}\n- **A**\n:::\n')
    expect(result.html).toMatch(/^<article><p class="block-issues">.*columns is not a prop/su)
    expect(result.html).toContain('<ul class="qb qb-cast">')
  })
})
