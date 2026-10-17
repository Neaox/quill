import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { gemoji } from 'gemoji'
import type { Root as HastRoot } from 'hast'
import { describe, expect, it } from 'vitest'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { renderHtml } from '../render/html.ts'
import type { CustomEmoji } from './emoji.ts'
import {
  EMOJI_ASSET_URL,
  EMOJI_NAME,
  emojiLookup,
  findShortcodes,
  guardEmojiImages,
} from './emoji.ts'
import { shortcodeModule, shortcodeTable } from './generate.ts'
import { standardEmoji } from './shortcodes.ts'

const ACME: CustomEmoji = {
  src: '/api/emoji/acme.0123456789abcdef.svg',
  width: 64,
  height: 64,
}
const GLOBEX: CustomEmoji = {
  src: '/api/emoji/globex_logo.fedcba9876543210.png',
  width: 128,
  height: 64,
}
const PARTY: CustomEmoji = {
  src: '/api/emoji/party.aaaaaaaaaaaaaaaa.gif',
  still: '/api/emoji/party.bbbbbbbbbbbbbbbb.gif',
  width: 32,
  height: 32,
}
const CUSTOM: ReadonlyMap<string, CustomEmoji> = new Map([
  ['acme', ACME],
  ['globex_logo', GLOBEX],
])

const THUMBS_UP = '<span class="emoji" role="img" aria-label="thumbs up">👍</span>'
const SMILE =
  '<span class="emoji" role="img" aria-label="grinning face with smiling eyes">😄</span>'
const ACME_IMAGE =
  '<img class="emoji" src="/api/emoji/acme.0123456789abcdef.svg" alt=":acme:" title=":acme:" width="20" height="20">'

const render = (
  markdown: string,
  options: Parameters<typeof renderHtml>[1] = { emoji: CUSTOM },
): string => renderHtml(parseMarkdown(markdown), { standardEmoji, ...options })

/** The paragraph's inner HTML, which is what every case below is about. */
const paragraph = (markdown: string, options?: Parameters<typeof renderHtml>[1]): string =>
  render(markdown, options)
    .replace(/^<article><p>/u, '')
    .replace(/<\/p><\/article>$/u, '')

describe('the generated shortcode table', () => {
  it('is GitHub’s list as gemoji publishes it, regenerated rather than edited', () => {
    const generated = readFileSync(
      fileURLToPath(new URL('shortcodes.gen.ts', import.meta.url)),
      'utf8',
    )
    expect(generated).toBe(shortcodeModule(gemoji))
  })

  it('keeps each emoji’s character, description and every alias', () => {
    expect(
      shortcodeTable([{ emoji: '👍', description: 'thumbs up', names: ['+1', 'thumbsup'] }]),
    ).toBe('👍\tthumbs up\t+1 thumbsup')
    expect(standardEmoji('+1')).toEqual({ character: '👍', description: 'thumbs up' })
    expect(standardEmoji('thumbsup')).toEqual(standardEmoji('+1'))
    expect(standardEmoji('-1')?.character).toBe('👎')
    expect(standardEmoji('tada')?.character).toBe('🎉')
    expect(standardEmoji('1st_place_medal')?.character).toBe('🥇')
    expect(standardEmoji('not-an-emoji')).toBeUndefined()
  })

  it('escapes what a template literal would read', () => {
    expect(shortcodeModule([{ emoji: '`', description: '\\', names: ['tick'] }])).toContain(
      'SHORTCODE_TABLE = `\\`\t\\\\\ttick`',
    )
  })
})

describe('standard shortcodes (ADR-038)', () => {
  it('draw the character, named by its description', () => {
    expect(paragraph(':smile:\n')).toBe(SMILE)
    expect(paragraph(':+1: and :-1:\n')).toBe(
      `${THUMBS_UP} and <span class="emoji" role="img" aria-label="thumbs down">👎</span>`,
    )
  })

  it('are found at the start, middle and end of a line', () => {
    expect(paragraph(':+1: first\n')).toBe(`${THUMBS_UP} first`)
    expect(paragraph('in :+1: between\n')).toBe(`in ${THUMBS_UP} between`)
    expect(paragraph('last :+1:\n')).toBe(`last ${THUMBS_UP}`)
  })

  it('may sit side by side, sharing nothing', () => {
    expect(paragraph(':smile::+1:\n')).toBe(`${SMILE}${THUMBS_UP}`)
  })

  it('leave an unknown name literal without swallowing the colon that opens the next', () => {
    expect(paragraph(':nope: :note:smile:\n')).toBe(`:nope: :note${SMILE}`)
  })

  it('leave times, ratios and colon-separated words as written', () => {
    expect(paragraph('At 10:30:00 sharp\n')).toBe('At 10:30:00 sharp')
    expect(paragraph('a:b:c\n')).toBe('a:b:c')
    expect(paragraph('status:ok\n')).toBe('status:ok')
  })

  it('are never read out of code, inline or fenced', () => {
    expect(paragraph('`:smile:`\n')).toBe('<code>:smile:</code>')
    expect(render('```\n:smile:\n```\n')).toBe(
      '<article><div class="code-block"><pre><code>:smile:</code></pre></div></article>',
    )
  })

  it('are never read out of an address', () => {
    expect(paragraph('https://example.com/:smile:/a:b\n')).toBe(
      '<a href="https://example.com/:smile:/a:b" rel="noopener noreferrer">https://example.com/:smile:/a:b</a>',
    )
    expect(paragraph('[ship it :tada:](/d/x)\n')).toContain(
      '<a href="/d/x">ship it <span class="emoji" role="img" aria-label="party popper">🎉</span></a>',
    )
  })

  it('are drawn in a link’s words beside its formatting', () => {
    expect(paragraph('[**ship** :tada:](/d/x)\n')).toBe(
      '<a href="/d/x"><strong>ship</strong> <span class="emoji" role="img" aria-label="party popper">🎉</span></a>',
    )
  })

  it('sit beside a badge without disturbing it', () => {
    expect(paragraph(':smile: next to :ok[Built]\n')).toBe(
      `${SMILE} next to <span class="badge" data-tone="success">Built</span>`,
    )
    expect(paragraph(':ok[Built]:smile:\n')).toBe(
      `<span class="badge" data-tone="success">Built</span>${SMILE}`,
    )
  })

  it('reach the tree as text, and every one of these is written back byte for byte', () => {
    for (const source of [
      'status:ok\n',
      ':ok[Built] :acme[Acme]{x="1"}\n',
      'At 10:30:00\n',
      ':smile: next to :ok[Built]\n',
      ':+1: in :+1: out :+1:\n',
      ':acme: on :acme[Acme]\n',
    ]) {
      expect(stringifyMdast(parseMarkdown(source))).toBe(source)
    }
    // The fact the whole design rests on: remark-directive refuses a name
    // closed by a colon. An upgrade that changes this fails here first.
    const [first] = parseMarkdown(':smile:\n').children
    expect(first?.type === 'paragraph' ? first.children : []).toEqual([
      expect.objectContaining({ type: 'text', value: ':smile:' }),
    ])
  })

  it('keep a heading’s anchor as its words', () => {
    expect(render('## :tada: Release\n')).toContain('id="user-content-tada-release"')
  })
})

describe('custom emoji (ADR-038)', () => {
  it('draw the organisation’s image at text size, named by its shortcode', () => {
    expect(paragraph('Inline with :acme:\n')).toBe(`Inline with ${ACME_IMAGE}`)
    expect(paragraph(':globex_logo:\n')).toContain('width="40" height="20"')
  })

  it('win over a standard emoji only where the names collide', () => {
    const custom = new Map([['smile', { ...ACME, src: '/api/emoji/smile.0123456789abcdef.png' }]])
    expect(paragraph(':smile: :+1:\n', { emoji: custom })).toBe(
      `<img class="emoji" src="/api/emoji/smile.0123456789abcdef.png" alt=":smile:" title=":smile:" width="20" height="20"> ${THUMBS_UP}`,
    )
  })

  it('are the only emoji drawn when GitHub’s table is not given', () => {
    expect(renderHtml(parseMarkdown(':+1: :acme:\n'), { emoji: CUSTOM })).toBe(
      `<article><p>:+1: ${ACME_IMAGE}</p></article>`,
    )
  })

  it('stay literal when the organisation defines none', () => {
    expect(paragraph(':acme:\n', {})).toBe(':acme:')
  })

  it('may be any of the web’s image types', () => {
    for (const extension of ['png', 'jpg', 'gif', 'webp', 'avif', 'svg']) {
      expect(EMOJI_ASSET_URL.test(`/api/emoji/acme.0123456789abcdef.${extension}`)).toBe(true)
    }
    expect(EMOJI_ASSET_URL.test('/api/emoji/acme.0123456789abcdef.tiff')).toBe(false)
  })

  it('draw an animation still for a reader who asks for less motion', () => {
    const party = new Map([['party', PARTY]])
    expect(paragraph(':party:\n', { emoji: party })).toBe(
      '<picture class="emoji"><source srcset="/api/emoji/party.bbbbbbbbbbbbbbbb.gif" media="(prefers-reduced-motion: reduce)"><img class="emoji" src="/api/emoji/party.aaaaaaaaaaaaaaaa.gif" alt=":party:" title=":party:" width="20" height="20"></picture>',
    )
  })

  it('carry an animation’s timing on its picture, for the reader’s brief play (ADR-047)', () => {
    const party = new Map([['party', { ...PARTY, frames: 12, milliseconds: 1200 }]])
    expect(paragraph(':party:\n', { emoji: party })).toBe(
      '<picture class="emoji" data-frames="12" data-loop-ms="1200"><source srcset="/api/emoji/party.bbbbbbbbbbbbbbbb.gif" media="(prefers-reduced-motion: reduce)"><img class="emoji" src="/api/emoji/party.aaaaaaaaaaaaaaaa.gif" alt=":party:" title=":party:" width="20" height="20"></picture>',
    )
    // Timing out of bounds is not drawn at all, rather than drawn and stripped.
    const wild = new Map([['party', { ...PARTY, frames: 2.5, milliseconds: 1e9 }]])
    expect(paragraph(':party:\n', { emoji: wild })).toContain('<picture class="emoji"><source')
  })

  it('draw an animation without a still that is not this server’s', () => {
    const party = new Map([['party', { ...PARTY, still: 'https://example.com/x.gif' }]])
    expect(paragraph(':party:\n', { emoji: party })).toBe(
      '<img class="emoji" src="/api/emoji/party.aaaaaaaaaaaaaaaa.gif" alt=":party:" title=":party:" width="20" height="20">',
    )
  })

  it('are drawn only from this server’s emoji route', () => {
    const elsewhere = new Map([['evil', { ...ACME, src: 'https://example.com/x.svg' }]])
    expect(paragraph(':evil:\n', { emoji: elsewhere })).toBe(':evil:')
    expect(EMOJI_ASSET_URL.test(ACME.src)).toBe(true)
    expect(EMOJI_ASSET_URL.test('/api/emoji/acme.0123456789abcdef.svg?x')).toBe(false)
    expect(EMOJI_NAME.test('globex_logo')).toBe(true)
    expect(EMOJI_NAME.test('Globex')).toBe(false)
  })
})

describe('labels and emoji share names; the syntax decides (ADR-038)', () => {
  const PILL = '<span class="badge" data-label="acme">Acme</span>'
  const LEADING =
    '<span class="badge" data-label="acme"><img class="emoji" src="/api/emoji/acme.0123456789abcdef.svg" alt="" width="20" height="20">Acme</span>'
  const source = ':acme: and :acme[Acme]\n'
  const labels = new Set(['acme'])

  it('draws both when both are defined, the pill led by its emoji', () => {
    expect(
      paragraph(source, { labels, emoji: CUSTOM, labelEmoji: new Map([['acme', 'acme']]) }),
    ).toBe(`${ACME_IMAGE} and ${LEADING}`)
  })

  it('draws only the emoji when only the emoji is defined', () => {
    expect(paragraph(source, { emoji: CUSTOM })).toBe(`${ACME_IMAGE} and :acme[Acme]`)
  })

  it('draws only the label when only the label is defined', () => {
    expect(paragraph(source, { labels })).toBe(`:acme: and ${PILL}`)
    // A label told to lead with an emoji that does not exist keeps its dot.
    expect(paragraph(source, { labels, labelEmoji: new Map([['acme', 'acme']]) })).toBe(
      `:acme: and ${PILL}`,
    )
  })

  it('draws neither when neither is defined', () => {
    expect(paragraph(source, {})).toBe(':acme: and :acme[Acme]')
  })

  it('lets a label lead with an emoji of another name, or one of GitHub’s', () => {
    expect(
      paragraph(':globex[Globex] :rocket[Launch]\n', {
        labels: new Set(['globex', 'rocket']),
        emoji: CUSTOM,
        labelEmoji: new Map([
          ['globex', 'globex_logo'],
          ['rocket', 'rocket'],
        ]),
      }),
    ).toBe(
      '<span class="badge" data-label="globex"><img class="emoji" src="/api/emoji/globex_logo.fedcba9876543210.png" alt="" width="40" height="20">Globex</span> <span class="badge" data-label="rocket"><span class="emoji" aria-hidden="true">🚀</span>Launch</span>',
    )
  })

  it('leads a table cell’s status line like any pill', () => {
    expect(
      render('| a |\n| - |\n| :acme[Acme] Prices. |\n', {
        labels,
        emoji: CUSTOM,
        labelEmoji: new Map([['acme', 'acme']]),
      }),
    ).toContain(
      `<span class="cell-status">${LEADING}</span><span class="cell-detail">Prices.</span>`,
    )
  })
})

describe('finding shortcodes', () => {
  const lookup = emojiLookup(CUSTOM, standardEmoji)

  it('reports each match’s offsets, so the editor can draw over them', () => {
    expect([...findShortcodes('a :+1: b :acme:', lookup)]).toEqual([
      {
        start: 2,
        end: 6,
        emoji: { kind: 'standard', name: '+1', character: '👍', description: 'thumbs up' },
      },
      { start: 9, end: 15, emoji: { kind: 'custom', name: 'acme', image: ACME } },
    ])
    expect([...findShortcodes('no colons here', lookup)]).toEqual([])
  })
})

describe('the emoji image guard', () => {
  it('takes the class off an image that is not an emoji’s', () => {
    const tree: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'img',
          properties: { className: ['emoji'], src: '/api/attachments/x' },
          children: [],
        },
        {
          type: 'element',
          tagName: 'img',
          properties: { className: ['emoji'], src: ACME.src },
          children: [],
        },
        { type: 'element', tagName: 'img', properties: { src: ACME.src }, children: [] },
      ],
    }
    expect(
      guardEmojiImages(tree).children.map((child) => child.type === 'element' && child.properties),
    ).toEqual([
      { src: '/api/attachments/x' },
      { className: ['emoji'], src: ACME.src },
      { src: ACME.src },
    ])
  })
})
