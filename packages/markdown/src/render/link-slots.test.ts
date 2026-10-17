import { createEmbedRegistry } from '@quill/domain'
import type { LinkPreview, LinkPreviewView, PreviewImage } from '@quill/domain'
import { fromHtml } from 'hast-util-from-html'
import { describe, expect, it } from 'vitest'
import { visit } from 'unist-util-visit'

import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from './html.ts'
import { fillLinkSlots, linkSlotKeys, scanLinkSlots } from './link-slots.ts'
import type { FillOptions } from './link-slots.ts'

const URL_A = 'https://blog.example/post'

const image = (hash: string, width = 640, height = 336): PreviewImage => ({
  hash,
  width,
  height,
  mediaType: 'image/webp',
})

function previewOf(overrides: Partial<LinkPreview> = {}): LinkPreview {
  return {
    url: URL_A,
    canonicalUrl: URL_A,
    title: 'How we cut deploy time',
    description: 'Caching & a lot of deleting.',
    siteName: 'Acme Engineering',
    kind: 'article',
    thumbnail: image('a'.repeat(64)),
    favicon: image('b'.repeat(64), 64, 64),
    layer: 'open-graph',
    fetchedAt: '2026-10-13T09:00:00.000Z',
    ...overrides,
  }
}

const ready = (preview: LinkPreview = previewOf()): LinkPreviewView => ({
  state: 'ready',
  preview,
  stale: false,
})

const OPTIONS: FillOptions = {
  defaultDisplay: 'inline',
  imageUrl: (picture) => `/i/${picture.hash}`,
}

/** The element names in a piece of HTML: what a browser would actually build from it. */
function tagsIn(html: string): Set<string> {
  const names = new Set<string>()
  visit(fromHtml(html, { fragment: true }), 'element', (node) => {
    names.add(node.tagName)
  })
  return names
}

const body = (markdown: string) => renderHtml(parseMarkdown(markdown))
const fill = (markdown: string, views: Record<string, LinkPreviewView>, options = OPTIONS) =>
  fillLinkSlots(body(markdown), new Map(Object.entries(views)), options)

describe('the body: a link directive is a slot, which is a plain link', () => {
  it('renders an inline link as an anchor carrying the address its preview is stored under', () => {
    const html = body('See :link[https://blog.example/post?utm_source=x#top]{display=inline} now.')
    expect(html).toContain('data-link-slot')
    expect(html).toContain('data-link-key="https://blog.example/post"')
    expect(html).toContain('href="https://blog.example/post?utm_source=x#top"')
    expect(html).toContain('data-display="inline"')
    expect(html).toContain('>https://blog.example/post?utm_source=x#top</a>')
  })

  it('renders a block link as an anchor in a paragraph of its own', () => {
    const html = body('::link{url="https://blog.example/post" display=card layout=top image=none}')
    expect(html).toContain('<p class="link-slot-block"><a')
    expect(html).toContain('data-display="card"')
    expect(html).toContain('data-layout="top"')
    expect(html).toContain('data-image="none"')
  })

  it('keeps the author’s words as the text of the link, and says they were theirs', () => {
    const html = body(':link[the design doc]{url="https://blog.example/post" display=inline}')
    expect(html).toContain('>the design doc</a>')
    expect(html).toContain('data-link-words')
  })

  it('carries a title and description the author wrote, escaped', () => {
    const html = body(
      '::link{url="https://blog.example/post" display=card title="A <b>bold</b> claim" description="Why"}',
    )
    // The markup is text inside an attribute, so no `b` element is ever built from it.
    expect(tagsIn(html).has('b')).toBe(false)
    expect(html).toContain('data-description="Why"')
  })

  it('draws an address it cannot use as the text it was written with, never as nothing', () => {
    expect(body(':link[not an address]')).toContain('not an address')
    expect(body(':link[not an address]')).not.toContain('data-link-slot')
    expect(body('::link{url="ftp://files.example/x"}')).toContain('ftp://files.example/x')
    expect(body('::link{url="ftp://files.example/x"}')).not.toContain('<a ')
  })

  it('never makes a script address into a link', () => {
    const html = body(':link[click]{url="javascript:alert(1)"}')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<a ')
    expect(html).toContain('click')
  })

  it('gives an external slot the same rel as any external link', () => {
    expect(body(':link[https://blog.example/post]')).toContain('rel="noopener noreferrer"')
  })

  it('has no display attribute when the author chose none, so the default decides at the page', () => {
    expect(body(':link[https://blog.example/post]')).not.toContain('data-display')
  })

  it('draws an unrecognised display as a plain link', () => {
    expect(body(':link[https://blog.example/post]{display=bookmark}')).toContain(
      'data-display="url"',
    )
  })
})

describe('linkSlotKeys', () => {
  it('lists the addresses a body will look up, each once, in order', () => {
    const html = body(
      [
        ':link[https://b.example/x?utm_source=1]',
        '',
        '::link{url="https://a.example/"}',
        '',
        ':link[again]{url="https://b.example/x"}',
      ].join('\n'),
    )
    expect(linkSlotKeys(html)).toEqual(['https://b.example/x', 'https://a.example/'])
  })

  it('is empty for a body with no slots, without parsing it', () => {
    expect(linkSlotKeys('<p>Nothing <a href="https://x.example/">here</a></p>')).toEqual([])
  })
})

describe('fillLinkSlots: an inline link', () => {
  it('becomes a favicon and the page’s title when it is a bare address', () => {
    const html = fill('See :link[https://blog.example/post]{display=inline} now.', {
      [URL_A]: ready(),
    })
    expect(html).toContain('class="link-chip"')
    expect(html).toContain('<span class="link-chip-text">How we cut deploy time</span>')
    expect(html).toContain(
      '<img class="link-chip-icon" src="/i/' + 'b'.repeat(64) + '" alt="" width="64" height="64"',
    )
    expect(html).not.toContain('data-link-slot')
  })

  it('keeps the author’s own words and adds only the icon', () => {
    const html = fill(':link[the design doc]{url="https://blog.example/post" display=inline}', {
      [URL_A]: ready(),
    })
    expect(html).toContain('<span class="link-chip-text">the design doc</span>')
    expect(html).not.toContain('How we cut deploy time"')
    expect(html).toContain('link-chip-icon')
  })

  it('uses the author’s title override over the page’s, for a bare address', () => {
    const html = fill(':link[https://blog.example/post]{display=inline title="Mine"}', {
      [URL_A]: ready(),
    })
    expect(html).toContain('>Mine</span>')
  })

  it('takes the default display when the author chose none', () => {
    const html = fill(':link[https://blog.example/post]', { [URL_A]: ready() })
    expect(html).toContain('link-chip')
  })

  it('is left as the plain link when the default is a plain link', () => {
    const html = fill(
      ':link[https://blog.example/post]',
      { [URL_A]: ready() },
      { ...OPTIONS, defaultDisplay: 'url' },
    )
    expect(html).toContain('data-link-slot')
    expect(html).not.toContain('link-chip')
  })

  it('is left as the plain link when the author chose a plain link', () => {
    const html = fill(':link[https://blog.example/post]{display=url}', { [URL_A]: ready() })
    expect(html).not.toContain('link-chip')
  })

  it('has no icon when the preview has none', () => {
    const html = fill(':link[https://blog.example/post]{display=inline}', {
      [URL_A]: ready(previewOf({ favicon: null })),
    })
    expect(html).toContain('link-chip-text')
    expect(html).not.toContain('<img')
  })

  it('draws a card choice on an inline link as a chip, since a card would break the sentence', () => {
    const html = fill('See :link[https://blog.example/post]{display=card} now.', {
      [URL_A]: ready(),
    })
    expect(html).toContain('link-chip')
    expect(html).not.toContain('link-card')
  })

  it('puts the description in the tooltip, not in the line', () => {
    const html = fill(':link[https://blog.example/post]{display=inline}', { [URL_A]: ready() })
    expect(html).toContain('title="Caching &#x26; a lot of deleting."')
  })
})

describe('fillLinkSlots: a block link', () => {
  const card = (markdown: string, preview: LinkPreview = previewOf()) =>
    fill(markdown, { [URL_A]: ready(preview) })

  it('becomes one anchor holding the title, the description, the site and the picture', () => {
    const html = card('::link{url="https://blog.example/post" display=card}')
    expect(html).toContain('<a class="link-card" href="https://blog.example/post"')
    expect(html).toContain('<strong class="link-card-title">How we cut deploy time</strong>')
    expect(html).toContain(
      '<span class="link-card-description">Caching &#x26; a lot of deleting.</span>',
    )
    expect(html).toContain('Acme Engineering')
    expect(html).toContain(
      '<img class="link-card-image" src="/i/' +
        'a'.repeat(64) +
        '" alt="" width="640" height="336"',
    )
    expect(html).not.toContain('link-slot-block')
  })

  it('draws a compact link as one line: icon, title and site, with no picture or summary', () => {
    const html = card('::link{url="https://blog.example/post" display=compact}')
    expect(html).toContain('<a class="link-compact" href="https://blog.example/post"')
    expect(html).toContain('<span class="link-compact-title">How we cut deploy time</span>')
    expect(html).toContain('<span class="link-compact-site">Acme Engineering</span>')
    expect(html).not.toContain('link-card')
    expect(html).not.toContain('link-slot-block')
  })

  it('draws a compact link as a chip in a line, as a card would be', () => {
    const html = fill('See :link[https://blog.example/post]{display=compact} now.', {
      [URL_A]: ready(),
    })
    expect(html).toContain('class="link-chip"')
    expect(html).not.toContain('link-compact')
  })

  it('adds the state a connector reported, in words, to a chip, a compact link and a card', () => {
    const preview = previewOf({ status: { label: 'Merged', tone: 'success' } })
    for (const markdown of [
      'See :link[https://blog.example/post]{display=inline}.',
      '::link{url="https://blog.example/post" display=compact}',
      '::link{url="https://blog.example/post" display=card}',
    ]) {
      expect(fill(markdown, { [URL_A]: ready(preview) })).toContain(
        '<span class="link-status" data-tone="success">Merged</span>',
      )
    }
  })

  it('says nothing about state for a page, which has none', () => {
    expect(
      fill('::link{url="https://blog.example/post" display=card}', { [URL_A]: ready() }),
    ).not.toContain('link-status')
  })

  it('is one link, not a link inside a paragraph', () => {
    const html = card('::link{url="https://blog.example/post" display=card}')
    expect(html.match(/<a /gu)).toHaveLength(1)
    expect(html).not.toContain('<p')
  })

  it('records its layout', () => {
    expect(card('::link{url="https://blog.example/post" display=card layout=top}')).toContain(
      'data-layout="top"',
    )
    expect(card('::link{url="https://blog.example/post" display=card}')).toContain(
      'data-layout="side"',
    )
  })

  it('drops the picture when the author did', () => {
    const html = card('::link{url="https://blog.example/post" display=card image=none}')
    expect(html).not.toContain('link-card-image')
    expect(html).not.toContain('data-image')
  })

  it('drops the picture when the preview has none', () => {
    expect(
      card('::link{url="https://blog.example/post" display=card}', previewOf({ thumbnail: null })),
    ).not.toContain('link-card-image')
  })

  it('shows the author’s title and description over the fetched ones', () => {
    const html = card(
      '::link{url="https://blog.example/post" display=card title="Mine" description="Because."}',
    )
    expect(html).toContain('>Mine</strong>')
    expect(html).toContain('>Because.</span>')
    expect(html).not.toContain('How we cut deploy time')
  })

  it('hides the description when the author asked for none', () => {
    const html = card('::link{url="https://blog.example/post" display=card description=""}')
    expect(html).not.toContain('link-card-description')
  })

  it('has no description line when the page has none', () => {
    expect(
      card(
        '::link{url="https://blog.example/post" display=card}',
        previewOf({ description: null }),
      ),
    ).not.toContain('link-card-description')
  })

  it('draws an embed as a card when the preview offers no frame', () => {
    expect(card('::link{url="https://blog.example/post" display=embed}')).toContain('link-card')
  })

  it('takes the default display when the author chose none', () => {
    const html = fill(
      '::link{url="https://blog.example/post"}',
      { [URL_A]: ready() },
      { ...OPTIONS, defaultDisplay: 'card' },
    )
    expect(html).toContain('link-card')
  })

  it('draws a block link as a chip in a line when the default is inline', () => {
    expect(fill('::link{url="https://blog.example/post"}', { [URL_A]: ready() })).toContain(
      'link-chip',
    )
  })

  it('has an empty site line rather than the word "null" when the preview names no site', () => {
    const html = card(
      '::link{url="https://blog.example/post" display=card}',
      previewOf({ siteName: null }),
    )
    expect(html).not.toContain('null')
  })
})

describe('fillLinkSlots: what it must not do', () => {
  const states: LinkPreviewView[] = [
    { state: 'pending' },
    { state: 'unavailable', reason: 'unreachable' },
    { state: 'blocked' },
  ]

  it.each(states)('leaves a slot as the plain link for a preview that is $state', (view) => {
    const original = body('See :link[https://blog.example/post]{display=inline} now.')
    expect(fillLinkSlots(original, new Map([[URL_A, view]]), OPTIONS)).toBe(
      fillLinkSlots(original, new Map(), OPTIONS),
    )
    expect(fillLinkSlots(original, new Map([[URL_A, view]]), OPTIONS)).toContain('data-link-slot')
  })

  it('fills the links that have a preview and leaves the others alone', () => {
    const html = fill(
      ':link[https://blog.example/post]{display=inline} and :link[https://other.example/]{display=inline}',
      { [URL_A]: ready() },
    )
    expect(html.match(/link-chip"/gu)).toHaveLength(1)
    expect(html.match(/data-link-slot/gu)).toHaveLength(1)
  })

  it('fills a repeated link everywhere it appears', () => {
    const html = fill(
      ':link[https://blog.example/post]{display=inline} :link[https://blog.example/post]{display=inline}',
      {
        [URL_A]: ready(),
      },
    )
    expect(html.match(/link-chip"/gu)).toHaveLength(2)
  })

  it('returns a body with no slots exactly as it came', () => {
    const plain = '<p>Hello <a href="https://x.example/">world</a> &amp; all</p>'
    expect(fillLinkSlots(plain, new Map([[URL_A, ready()]]), OPTIONS)).toBe(plain)
  })

  it('touches nothing else in the body', () => {
    const html = fill(
      '# Title\n\nSome text with `code` and :link[https://blog.example/post]{display=inline}.\n\n- a\n- b',
      {
        [URL_A]: ready(),
      },
    )
    expect(html).toContain('<h1')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<li>a</li>')
  })

  it('escapes whatever a stranger’s page said', () => {
    const hostile = previewOf({
      title: '<img src=x onerror=alert(1)>',
      description: '"><script>alert(1)</script>',
      siteName: '<b>site</b>',
    })
    const inline = fill(':link[https://blog.example/post]{display=inline}', {
      [URL_A]: ready(hostile),
    })
    const block = fill('::link{url="https://blog.example/post" display=card}', {
      [URL_A]: ready(hostile),
    })
    for (const html of [inline, block]) {
      // Whatever the page said is text; the only elements are the ones this module builds.
      const names = tagsIn(html)
      expect(names.has('script')).toBe(false)
      expect(names.has('b')).toBe(false)
      const handlers: unknown[] = []
      const sources: string[] = []
      visit(fromHtml(html, { fragment: true }), 'element', (node) => {
        handlers.push(node.properties['onerror'])
        if (node.tagName === 'img') sources.push(String(node.properties['src']))
      })
      expect(handlers.every((handler) => handler === undefined)).toBe(true)
      expect(sources.every((source) => source.startsWith('/i/'))).toBe(true)
    }
  })

  it('serves pictures only from where it is told, never from the page’s own address', () => {
    const html = fill('::link{url="https://blog.example/post" display=card}', { [URL_A]: ready() })
    expect(html).not.toMatch(/src="https?:/u)
  })
})

describe('an export: a body that was never filled', () => {
  it('is every link as a plain, working link with its words', () => {
    const exported = body(
      [
        'Read :link[https://blog.example/post]{display=inline} and :link[the design doc]{url="https://blog.example/d" display=inline}.',
        '',
        '::link{url="https://blog.example/post" display=card layout=top}',
      ].join('\n'),
    )
    expect(exported).not.toContain('link-chip')
    expect(exported).not.toContain('link-card')
    expect(exported).not.toContain('<img')
    expect(exported.match(/<a /gu)).toHaveLength(3)
    expect(exported).toContain('>https://blog.example/post</a>')
    expect(exported).toContain('>the design doc</a>')
  })
})

const slot = (attributes: string, words = 'words') =>
  `<a href="https://blog.example/post" data-link-slot="" ${attributes}>${words}</a>`

describe('a body that was not made by this module', () => {
  it('leaves a slot with no address to look up as the link it is', () => {
    const html = `<p>${slot('data-display="inline"')}</p>`
    expect(fillLinkSlots(html, new Map([[URL_A, ready()]]), OPTIONS)).toContain('data-link-slot')
    expect(linkSlotKeys(html)).toEqual([])
  })

  it('reads text and other nodes beside the elements at the top of a fragment', () => {
    const html = `before <!-- note -->${slot(`data-link-key="${URL_A}" data-display="inline"`)}`
    const filled = fillLinkSlots(html, new Map([[URL_A, ready()]]), OPTIONS)
    expect(filled.startsWith('before <!--')).toBe(true)
    expect(filled).toContain('link-chip')
  })

  it('does not treat a block paragraph holding more than a slot as a block link', () => {
    const html = `<p class="link-slot-block">see ${slot(`data-link-key="${URL_A}" data-display="card"`)}</p>`
    const filled = fillLinkSlots(html, new Map([[URL_A, ready()]]), OPTIONS)
    expect(filled).toContain('link-chip')
    expect(filled).not.toContain('link-card')
  })

  it('leaves an empty block paragraph alone', () => {
    const html = '<p class="link-slot-block"></p>'
    expect(fillLinkSlots(html + slot('data-link-key="x"'), new Map(), OPTIONS)).toContain(html)
  })

  it('has no tooltip when the page has no description', () => {
    const html = fill(':link[https://blog.example/post]{display=inline}', {
      [URL_A]: ready(previewOf({ description: null })),
    })
    expect(html).not.toContain('title=')
  })
})

const blockSlot = (key: string) =>
  `<p class="link-slot-block"><a href="${key}" data-link-slot="" data-link-key="${key}" data-display="card">${key}</a></p>`

describe('finding slots in a body that someone has tried to confuse', () => {
  const real = `<a href="${URL_A}" data-link-slot="" data-link-key="${URL_A}" data-display="inline">words</a>`

  it('does not take the marker written as ordinary text for a slot', () => {
    const html = `<p>the attribute data-link-slot marks a link</p><p>${real}</p>`
    expect(linkSlotKeys(html)).toEqual([URL_A])
    const filled = fillLinkSlots(html, new Map([[URL_A, ready()]]), OPTIONS)
    expect(filled.startsWith('<p>the attribute data-link-slot marks a link</p>')).toBe(true)
    expect(filled).toContain('link-chip')
  })

  it('does not take the marker inside another attribute for a slot', () => {
    const decoy =
      '<img alt="&#x3C;a href=&#x22;https://evil.example/&#x22; data-link-slot data-link-key=&#x22;https://evil.example/&#x22;" src="/x.png">'
    const html = `${decoy}<p>${real}</p>`
    expect(linkSlotKeys(html)).toEqual([URL_A])
    expect(fillLinkSlots(html, new Map([[URL_A, ready()]]), OPTIONS).startsWith(decoy)).toBe(true)
  })

  it('does not take a marker that is not on an anchor that began with its address', () => {
    const html = `<a class="x" data-link-slot="" data-link-key="${URL_A}">no</a>`
    expect(linkSlotKeys(html)).toEqual([])
  })

  it('ignores an anchor that is never closed', () => {
    expect(
      linkSlotKeys(`<a href="${URL_A}" data-link-slot="" data-link-key="${URL_A}">oops`),
    ).toEqual([])
  })

  it('finds many slots, each paragraph block and inline, and fills them all', () => {
    const html = `<h1>t</h1>${blockSlot('https://a.example/')}<p>x ${real} y</p>${blockSlot('https://b.example/')}`
    const slots = scanLinkSlots(html)
    expect(slots.keys).toEqual(['https://a.example/', URL_A, 'https://b.example/'])
    const filled = slots.draw(
      new Map([
        ['https://a.example/', ready(previewOf({ url: 'https://a.example/' }))],
        ['https://b.example/', ready(previewOf({ url: 'https://b.example/' }))],
      ]),
      OPTIONS,
    )
    expect(filled.match(/class="link-card"/gu)).toHaveLength(2)
    expect(filled).toContain('<h1>t</h1>')
    expect(filled).toContain(`<p>x ${real} y</p>`)
  })

  it('fills the same on every call, from the same scan', () => {
    const slots = scanLinkSlots(`<p>${real}</p>`)
    const views = new Map([[URL_A, ready()]])
    expect(slots.draw(views, OPTIONS)).toBe(slots.draw(views, OPTIONS))
  })

  it('stays fast on a large body: a scan is a search, not a parse', () => {
    const big = `<p>text</p>`.repeat(30_000) + `<p>${real}</p>`
    const started = performance.now()
    expect(linkSlotKeys(big)).toEqual([URL_A])
    // A generous bound: the attack it guards against takes tens of seconds, and a busy machine takes one.
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('an embed: a sandboxed, lazy frame from the allowlist (ADR-042)', () => {
  const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const embed = {
    provider: 'youtube',
    src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    aspectRatio: 16 / 9,
  }
  const video = previewOf({ url: VIDEO, canonicalUrl: VIDEO, title: 'A <talk> & "more"', embed })
  const options: FillOptions = { ...OPTIONS, embeds: createEmbedRegistry([]) }
  const markdown = `::link{url="${VIDEO}" display=embed}`
  const drawn = (preview: LinkPreview = video, withOptions: FillOptions = options) =>
    fill(markdown, { [VIDEO]: ready(preview) }, withOptions)

  it('draws one lazy, sandboxed iframe in a figure that holds its place', () => {
    const html = drawn()
    expect(tagsIn(html)).toEqual(
      new Set(['article', 'figure', 'div', 'iframe', 'figcaption', 'a', 'span']),
    )
    expect(html).toContain('<figure class="link-embed" data-provider="youtube" data-ratio="16-9">')
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"')
    expect(html).toContain('allow="encrypted-media; picture-in-picture; fullscreen"')
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"')
    expect(html).not.toMatch(/allowfullscreen|allow-top-navigation|allow-popups|allow-forms/u)
  })

  it('gives the frame a visible, escaped title and a plain link to the page as its fallback', () => {
    const html = drawn()
    expect(html).toContain('title="A <talk> &#x26; &#x22;more&#x22; (YouTube)"')
    expect(html).toContain(
      `<a href="${VIDEO}" rel="noopener noreferrer">A &#x3C;talk> &#x26; "more"</a>`,
    )
    expect(html).toContain('>YouTube</span>')
  })

  it('shows the author’s title in the caption and the frame', () => {
    const html = fill(
      `::link{url="${VIDEO}" display=embed title="Mine"}`,
      { [VIDEO]: ready(video) },
      options,
    )
    expect(html).toContain('>Mine</a>')
    expect(html).toContain('title="Mine (YouTube)"')
  })

  it('names the nearest shape for a ratio, because the stylesheet cannot take an inline style', () => {
    const html = drawn({ ...video, embed: { ...embed, aspectRatio: 1.31 } })
    expect(html).toContain('data-ratio="4-3"')
  })

  it.each([
    ['a frame on another origin', { ...embed, src: 'https://evil.example/embed/x' }],
    ['a script address', { ...embed, src: 'javascript:alert(1)' }],
    ['a provider that is not on the list', { ...embed, provider: 'nope' }],
    [
      'an address with credentials',
      { ...embed, src: 'https://www.youtube-nocookie.com@evil.example/' },
    ],
  ])('draws a card, not a frame, for %s', (_name, bad) => {
    const html = drawn({ ...video, embed: bad })
    expect(html).toContain('link-card')
    expect(html).not.toContain('<iframe')
  })

  it('draws a card for a provider the operator has switched off', () => {
    const html = drawn(video, { ...options, embeds: createEmbedRegistry(['youtube']) })
    expect(html).toContain('link-card')
    expect(html).not.toContain('<iframe')
  })

  it('draws a card when it was given no allowlist at all', () => {
    const html = drawn(video, OPTIONS)
    expect(html).toContain('link-card')
    expect(html).not.toContain('<iframe')
  })

  it('draws a chip for an embed in the middle of a sentence', () => {
    const html = fill(`See :link[${VIDEO}]{display=embed} now.`, { [VIDEO]: ready(video) }, options)
    expect(html).toContain('link-chip')
    expect(html).not.toContain('<iframe')
  })

  it('leaves the unfilled body, which is what an export holds, without any frame', () => {
    expect(body(markdown)).not.toContain('<iframe')
  })
})
