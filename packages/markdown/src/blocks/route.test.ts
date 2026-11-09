import { describe, expect, it } from 'vitest'

import type { CustomEmoji } from '../emoji/emoji.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { renderDocument } from '../render/html.ts'

/** The organisation's own emoji, as rookwood's documentation names them (ADR-038). */
const EMOJI: ReadonlyMap<string, CustomEmoji> = new Map(
  ['airbnb', 'mail', 'inbox', 'rookwood', 'booking'].map((name) => [
    name,
    { src: `/api/emoji/${name}.0123456789abcdef.svg`, width: 16, height: 16 },
  ]),
)

const icon = (name: string): string =>
  `<img class="emoji" src="/api/emoji/${name}.0123456789abcdef.svg" alt="" width="20" height="20">`

const rendered = (markdown: string) => renderDocument(parseMarkdown(markdown), { emoji: EMOJI })

/** The paragraph a route sits in, without the article around it. */
const paragraph = (markdown: string): string =>
  rendered(markdown)
    .html.replace(/^<article><p>/u, '')
    .replace(/<\/p><\/article>$/u, '')

const party = (name: string, words: string): string =>
  `<span class="qb-route-party">${icon(name)}${words}</span>`

const leg = (arrow: string, said: string, to: string): string =>
  `<span class="qb-route-leg"><span class="qb-route-to"><span aria-hidden="true">${arrow}</span><span class="sr-only"> ${said} </span></span>${to}</span>`

describe(':route[…]', () => {
  it('draws parties as chips, each led by its emoji as decoration, joined by arrows said in words', () => {
    expect(paragraph(':route[:airbnb: Airbnb, :mail: Postmark → :inbox: Gateway]\n')).toBe(
      [
        '<span class="qb qb-route">',
        party('airbnb', 'Airbnb'),
        ' ',
        party('mail', 'Postmark'),
        leg('→', 'to', party('inbox', 'Gateway')),
        '</span>',
      ].join(''),
    )
  })

  it('reads every arrow, and says each one', () => {
    const html = paragraph(':route[:rookwood: A ← :rookwood: B ↔ :rookwood: C ⇄ :rookwood: D]\n')
    expect(html).toContain(leg('←', 'from', party('rookwood', 'B')))
    expect(html).toContain(leg('↔', 'to and from', party('rookwood', 'C')))
    expect(html).toContain(leg('⇄', 'exchanging with', party('rookwood', 'D')))
  })

  it('keeps the parties after the first on a side outside its leg, so they wrap as words', () => {
    expect(
      paragraph(':route[:rookwood: Transport → :airbnb: Airbnb, :booking: Booking.com]\n'),
    ).toBe(
      [
        '<span class="qb qb-route">',
        party('rookwood', 'Transport'),
        leg('→', 'to', party('airbnb', 'Airbnb')),
        party('booking', 'Booking.com'),
        '</span>',
      ].join(''),
    )
  })

  it('is a row of chips when it has no arrow', () => {
    expect(paragraph(':route[:booking: Booking.com, :airbnb: Airbnb]\n')).toBe(
      `<span class="qb qb-route">${party('booking', 'Booking.com')} ${party('airbnb', 'Airbnb')}</span>`,
    )
  })

  it('splits two parties only where an emoji leads the second, as rookwood does', () => {
    expect(paragraph(':route[:mail: Postmark, SES and SMTP]\n')).toBe(
      `<span class="qb qb-route">${party('mail', 'Postmark, SES and SMTP')}</span>`,
    )
  })

  it('needs spaces around an arrow, so an arrow inside a word is the word', () => {
    expect(paragraph(':route[:mail: A→B]\n')).toBe(
      `<span class="qb qb-route">${party('mail', 'A→B')}</span>`,
    )
  })

  it('draws a party with no emoji, and one whose shortcode names none, as words', () => {
    expect(paragraph(':route[:rookwood: API → Caller, :nobody: Them]\n')).toBe(
      [
        '<span class="qb qb-route">',
        party('rookwood', 'API'),
        leg('→', 'to', '<span class="qb-route-party">Caller</span>'),
        '<span class="qb-route-party">:nobody: Them</span>',
        '</span>',
      ].join(''),
    )
  })

  it('draws a party’s name as the inline Markdown it is', () => {
    expect(
      paragraph(':route[:rookwood: **The** `api` → :mail: [Postmark](https://postmarkapp.com)]\n'),
    ).toContain(`${party('rookwood', '<strong>The</strong> <code>api</code>')}`)
    expect(
      paragraph(':route[:rookwood: API → :mail: [Postmark](https://postmarkapp.com)]\n'),
    ).toContain(
      `${icon('mail')}<a href="https://postmarkapp.com" rel="noopener noreferrer">Postmark</a>`,
    )
  })

  it('sits in a table cell and in a sentence', () => {
    const html = rendered(
      '| Who | What |\n| - | - |\n| :route[:airbnb: Airbnb → :inbox: Gateway] | Sends |\n',
    ).html
    expect(html).toContain(`<td><span class="qb qb-route">${party('airbnb', 'Airbnb')}`)
    expect(paragraph('From :route[:airbnb: Airbnb] to us.\n')).toBe(
      `From <span class="qb qb-route">${party('airbnb', 'Airbnb')}</span> to us.`,
    )
  })

  it('takes no props, and says so beside it when one is written', () => {
    const { html, blockIssues } = rendered(':route[:mail: A → :inbox: B]{way=both}\n')
    expect(html).toContain(
      '</span><span class="block-issues"> (way is not a prop of this block; it takes none.)</span>',
    )
    expect(blockIssues).toEqual([
      { block: 'route', message: 'way is not a prop of this block; it takes none', line: 1 },
    ])
  })

  it('is written as an inline block only, and a container of the name says so', () => {
    const { html, blockIssues } = rendered(':::route\nA → B\n:::\n')
    expect(html).toContain('aria-label="route is written :route[…]: route"')
    expect(blockIssues[0]?.message).toBe('route is written :route[…]')
  })

  it('without emoji, still draws its chips, the shortcodes as written', () => {
    expect(renderDocument(parseMarkdown(':route[:airbnb: Airbnb → :inbox: Gateway]\n')).html).toBe(
      [
        '<article><p><span class="qb qb-route"><span class="qb-route-party">:airbnb: Airbnb</span>',
        '<span class="qb-route-leg"><span class="qb-route-to"><span aria-hidden="true">→</span>',
        '<span class="sr-only"> to </span></span><span class="qb-route-party">:inbox: Gateway</span>',
        '</span></span></p></article>',
      ].join(''),
    )
  })

  it('keeps what an author cannot write as markup as text', () => {
    expect(paragraph(':route[:mail: <script>alert(1)</script> → :inbox: B]\n')).toContain(
      `${icon('mail')}&#x3C;script>alert(1)&#x3C;/script></span>`,
    )
  })
})

const glyphOf = (name: string): string =>
  `<svg class="emoji emoji-glyph" viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><use href="/api/emoji/${name}.0123456789abcdef.svg#glyph" width="16" height="16"></use></svg>`

describe('the documentation kit with monochrome emoji (ADR-038, amended)', () => {
  const MONO: ReadonlyMap<string, CustomEmoji> = new Map(
    ['clock', 'inbox', 'rookwood'].map((name) => [
      name,
      { src: `/api/emoji/${name}.0123456789abcdef.svg`, width: 16, height: 16, monochrome: true },
    ]),
  )
  const glyph = glyphOf

  it('draws a party’s, a node’s and a time chip’s icon as a glyph, in the colour of each', () => {
    const { html } = renderDocument(
      parseMarkdown(
        '::::timeline\n:::step{icon=inbox}\n:clock: **Later** · :rookwood: Worker → :inbox: Gateway\n:::\n::::\n',
      ),
      { emoji: MONO },
    )
    expect(html).toContain(`<span class="qb-step-node">${glyph('inbox')}</span>`)
    expect(html).toContain(`data-tone="accent">${glyph('clock')}Later</span>`)
    expect(html).toContain(`<span class="qb-route-party">${glyph('rookwood')}Worker</span>`)
  })
})
