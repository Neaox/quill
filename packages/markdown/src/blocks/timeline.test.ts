import { describe, expect, it } from 'vitest'

import type { CustomEmoji } from '../emoji/emoji.ts'
import { standardEmoji } from '../emoji/shortcodes.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { renderDocument } from '../render/html.ts'

const EMOJI: ReadonlyMap<string, CustomEmoji> = new Map(
  ['clock', 'loop', 'northgate', 'rookwood', 'inbox', 'calendar', 'person'].map((name) => [
    name,
    { src: `/api/emoji/${name}.0123456789abcdef.svg`, width: 16, height: 16 },
  ]),
)

const icon = (name: string): string =>
  `<img class="emoji" src="/api/emoji/${name}.0123456789abcdef.svg" alt="" width="20" height="20">`

const rendered = (markdown: string) =>
  renderDocument(parseMarkdown(markdown), { emoji: EMOJI, standardEmoji })

const html = (markdown: string): string => rendered(markdown).html

/** A timeline around steps, as a guide writes one. */
const timeline = (...steps: readonly string[]): string =>
  ['::::timeline', '', ...steps.flatMap((step) => [step, '']), '::::', ''].join('\n')

const step = (attributes: string, ...lines: readonly string[]): string =>
  [`:::step${attributes}`, '', ...lines.flatMap((line) => [line, '']), ':::'].join('\n')

/** A step's when-line as drawn, from the markup between its node and its content. */
const whenLine = (markdown: string): string => {
  const found = /<p class="qb-step-when">(.*?)<\/p>/su.exec(html(markdown))
  return found?.[1] ?? ''
}

const party = (name: string, words: string): string =>
  `<span class="qb-route-party">${icon(name)}${words}</span>`

const to = (party_: string): string =>
  `<span class="qb-route-leg"><span class="qb-route-to"><span aria-hidden="true">→</span><span class="sr-only"> to </span></span>${party_}</span>`

describe('::::timeline', () => {
  it('is an ordered list of its steps, each a list item with its node, when-line and content', () => {
    expect(
      html(
        timeline(
          step(
            '{icon=northgate tone=outside}',
            ':clock: **Any time later** · :northgate: Northgate → :rookwood: Gateway',
            '### Northgate asks whether the book is on the shelf',
            'Before the reader leaves.',
            ':ok[Holds] Northgate gets an answer.',
          ),
        ),
      ),
    ).toBe(
      [
        '<article><ol class="qb qb-timeline"><li class="qb qb-step">',
        `<span class="qb-step-node" data-qb-tone="outside">${icon('northgate')}</span>`,
        '<p class="qb-step-when">',
        `<span class="badge qb-step-chip qb-step-time" data-tone="accent">${icon('clock')}Any time later</span>`,
        ` <span class="qb-route">${party('northgate', 'Northgate')}${to(party('rookwood', 'Gateway'))}</span>`,
        '</p>\n',
        '<h3 id="user-content-northgate-asks-whether-the-book-is-on-the-shelf" aria-labelledby="user-content-title.northgate-asks-whether-the-book-is-on-the-shelf">',
        '<span id="user-content-title.northgate-asks-whether-the-book-is-on-the-shelf">Northgate asks whether the book is on the shelf</span>',
        '<a class="heading-anchor" href="#user-content-northgate-asks-whether-the-book-is-on-the-shelf" aria-label="Link to this section: Northgate asks whether the book is on the shelf"><span aria-hidden="true">#</span></a></h3>\n',
        '<p>Before the reader leaves.</p>\n',
        '<p><span class="badge" data-tone="success" data-badge="ok">Holds</span> Northgate gets an answer.</p>\n',
        '</li></ol></article>',
      ].join(''),
    )
  })

  it('keeps its steps in order, with nested blocks inside them', () => {
    // Written as guides write it: the outer block with the most colons.
    const result = rendered(
      [
        ':::::timeline',
        '',
        '::::step{icon=person}',
        '',
        '**Start**',
        '',
        'First.',
        '',
        ':::checks',
        '',
        '1. One',
        '2. Two',
        '',
        ':::',
        '',
        '::::',
        '',
        '::::step{icon=inbox}',
        '',
        'Second.',
        '',
        '::::',
        '',
        ':::::',
        '',
      ].join('\n'),
    )
    expect(result.html).toContain('<ol class="qb qb-checks"><li>One</li><li>Two</li></ol>')
    expect(result.html.indexOf('First.')).toBeLessThan(result.html.indexOf('Second.'))
    expect(result.html.match(/<li class="qb qb-step">/gu)).toHaveLength(2)
    expect(result.blockIssues).toEqual([])
  })

  it('gives every heading in its steps the anchor the outline has, once', () => {
    const result = rendered(
      timeline(
        step('{icon=clock}', '### One'),
        step('{icon=clock}', ':clock: **Later**', '### Two'),
      ),
    )
    expect(result.outline.map((entry) => entry.id)).toEqual([
      'user-content-one',
      'user-content-two',
    ])
    expect(result.html).toContain('id="user-content-one"')
    expect(result.html).toContain('id="user-content-two"')
    expect(result.html).not.toContain('one-1')
  })

  it('shows Markdown that is not a step before it, and says so', () => {
    const result = rendered('::::timeline\nStray words.\n\n:::step\nA step.\n:::\n::::\n')
    expect(result.html).toMatch(
      /^<article><p class="block-issues">.*timeline holds only step blocks; the rest is shown first\.<\/p>\n<p>Stray words\.<\/p>\n<ol class="qb qb-timeline">/su,
    )
    expect(result.blockIssues.map((issue) => issue.message)).toEqual([
      'timeline holds only step blocks; the rest is shown first',
    ])
  })

  it('draws a step with a prop that does not fit in its place, with its note', () => {
    const drawn = html(timeline(step('{icon=clock}', 'Good.'), step('{tone=purple}', 'Bad tone.')))
    expect(drawn).toContain('<li class="qb qb-step"><span class="qb-step-node">')
    expect(drawn).toContain(
      '<p class="block-issues"><span class="block-issues-label">Check this block</span> tone: “purple” is not one of outside, net; left out.</p>',
    )
  })

  it('takes no props', () => {
    expect(rendered(timeline(step('', 'x'))).blockIssues).toEqual([])
    expect(rendered('::::timeline{dense}\n:::step\nx\n:::\n::::\n').blockIssues).toEqual([
      { block: 'timeline', message: 'dense is not a prop of this block; it takes none', line: 1 },
    ])
  })
})

describe(':::step', () => {
  it('reads its icon as an emoji drawn in its node, and its tone', () => {
    expect(html(timeline(step('{icon=rookwood tone=net}', 'x')))).toContain(
      `<span class="qb-step-node" data-qb-tone="net">${icon('rookwood')}</span>`,
    )
  })

  it('draws a standard emoji as its icon too, as decoration', () => {
    expect(html(timeline(step('{icon=rocket}', 'x')))).toContain(
      '<span class="qb-step-node"><span class="emoji" aria-hidden="true">🚀</span></span>',
    )
  })

  it('leaves its node empty when no emoji has its icon’s name', () => {
    expect(html(timeline(step('{icon=nothing}', 'x')))).toContain(
      '<span class="qb-step-node"></span>',
    )
  })

  it('reports a tone that is not one of its tones, and draws it without', () => {
    const result = rendered(timeline(step('{icon=clock tone=purple}', 'x')))
    expect(result.html).toContain(`<span class="qb-step-node">${icon('clock')}</span>`)
    expect(result.blockIssues).toEqual([
      {
        block: 'step',
        message: 'tone: “purple” is not one of outside, net; left out',
        line: 3,
      },
    ])
  })

  it('is drawn in the frame of a block that cannot be drawn outside a timeline', () => {
    const result = rendered(':::step{icon=clock}\n**Start**\n\nAlone.\n:::\n')
    expect(result.html).toContain(
      '<div class="block-fallback" role="group" aria-label="step belongs inside timeline: step">',
    )
    expect(result.html).toContain('<p>Alone.</p>')
    expect(result.blockIssues.map((issue) => issue.message)).toEqual([
      'step belongs inside timeline',
    ])
  })

  describe('its when-line', () => {
    it('is a chip of the bold words, a time when an emoji leads them', () => {
      expect(whenLine(timeline(step('', ':clock: **Up to 5 s later**', 'x')))).toBe(
        `<span class="badge qb-step-chip qb-step-time" data-tone="accent">${icon('clock')}Up to 5 s later</span>`,
      )
    })

    it('is a neutral chip when no emoji leads the bold words', () => {
      expect(whenLine(timeline(step('', '**Check 1**', 'x')))).toBe(
        '<span class="badge qb-step-chip">Check 1</span>',
      )
    })

    it('has a route after each ` · `', () => {
      expect(
        whenLine(
          timeline(
            step(
              '',
              ':clock: **Start** · :northgate: Northgate → :inbox: Gateway · :rookwood: Worker → :calendar: Catalogue',
              'x',
            ),
          ),
        ),
      ).toBe(
        [
          `<span class="badge qb-step-chip qb-step-time" data-tone="accent">${icon('clock')}Start</span>`,
          ` <span class="qb-route">${party('northgate', 'Northgate')}${to(party('inbox', 'Gateway'))}</span>`,
          ` <span class="qb-route">${party('rookwood', 'Worker')}${to(party('calendar', 'Catalogue'))}</span>`,
        ].join(''),
      )
    })

    it('is routes alone when it opens with no bold words', () => {
      expect(whenLine(timeline(step('', ':rookwood: Engine → :rookwood: Ledger', 'x')))).toBe(
        `<span class="qb-route">${party('rookwood', 'Engine')}${to(party('rookwood', 'Ledger'))}</span>`,
      )
    })

    it('is routes alone when words follow the bold ones without a ` · `', () => {
      expect(whenLine(timeline(step('', '**Check 1** of five', 'x')))).toBe(
        '<span class="qb-route"><span class="qb-route-party"><strong>Check 1</strong> of five</span></span>',
      )
    })

    it('draws a route written whole as that route', () => {
      expect(whenLine(timeline(step('', '**Before sending** · :route[:rookwood: API]', 'x')))).toBe(
        `<span class="badge qb-step-chip">Before sending</span> <span class="qb qb-route">${party('rookwood', 'API')}</span>`,
      )
    })

    it('keeps a shortcode no emoji answers to in the chip, as written', () => {
      expect(whenLine(timeline(step('', ':nothing: **Soon**', 'x')))).toBe(
        '<span class="badge qb-step-chip">:nothing: Soon</span>',
      )
    })

    it('is absent when the step opens with its heading', () => {
      const drawn = html(timeline(step('{icon=clock}', '### Straight in', 'Text.')))
      expect(drawn).not.toContain('qb-step-when')
      expect(drawn).toContain(`${icon('clock')}</span>\n<h3`)
    })

    it('is read across a line break in the source', () => {
      expect(
        whenLine(
          timeline(step('', ':clock: **Start** · :northgate: Northgate\n→ :inbox: Gateway', 'x')),
        ),
      ).toBe(
        `<span class="badge qb-step-chip qb-step-time" data-tone="accent">${icon('clock')}Start</span> <span class="qb-route">${party('northgate', 'Northgate')}${to(party('inbox', 'Gateway'))}</span>`,
      )
    })
  })
})
