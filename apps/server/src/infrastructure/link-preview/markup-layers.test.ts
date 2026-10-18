import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { MARKUP_LAYERS, openGraphLayer, pageLayer, twitterCardLayer } from './markup-layers.ts'
import { extractPageMetadata } from './page-metadata.ts'
import { isRich } from './preview-draft.ts'

const load = (name: string, url: string) =>
  extractPageMetadata(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'), url)

const ARTICLE_URL = 'https://engineering.acme.example/posts/deploy-time'

describe('openGraphLayer', () => {
  const page = load('article-open-graph.html', ARTICLE_URL)

  it('builds a rich article draft, resolving the image against the page', () => {
    expect(openGraphLayer(page, ARTICLE_URL)).toEqual({
      layer: 'open-graph',
      title: 'How we cut deploy time by 80%',
      description: 'Caching, parallelism & a lot of deleting.',
      siteName: 'Acme Engineering',
      kind: 'article',
      imageUrl: 'https://engineering.acme.example/images/deploy-hero.png',
      canonicalUrl: 'https://engineering.acme.example/posts/deploy-time',
    })
  })

  it('answers null for a page with no Open Graph tags', () => {
    expect(
      openGraphLayer(load('twitter-card-only.html', 'https://x.example/'), 'https://x.example/'),
    ).toBeNull()
  })

  it('borrows the page title when the tags carry an image but no title', () => {
    const html = '<title>Page title</title><meta property="og:image" content="/i.png">'
    const draft = openGraphLayer(
      extractPageMetadata(html, 'https://x.example/a'),
      'https://x.example/a',
    )
    expect(draft).toMatchObject({ title: 'Page title', imageUrl: 'https://x.example/i.png' })
  })

  it.each([
    ['article', 'article'],
    ['video.movie', 'video'],
    ['music.song', 'audio'],
    ['profile', 'profile'],
    ['website', 'website'],
    ['product', 'website'],
    ['VIDEO.other', 'video'],
  ])('maps og:type %s to the kind %s', (type, kind) => {
    const html = `<meta property="og:title" content="T"><meta property="og:type" content="${type}">`
    const draft = openGraphLayer(
      extractPageMetadata(html, 'https://x.example/'),
      'https://x.example/',
    )
    expect(draft?.kind).toBe(kind)
  })

  it('defaults to a website when og:type is absent', () => {
    const html = '<meta property="og:title" content="T">'
    expect(
      openGraphLayer(extractPageMetadata(html, 'https://x.example/'), 'https://x.example/')?.kind,
    ).toBe('website')
  })

  it('prefers og:image and falls back to its secure_url twin', () => {
    const html =
      '<meta property="og:title" content="T"><meta property="og:image:secure_url" content="https://c.example/s.png">'
    expect(
      openGraphLayer(extractPageMetadata(html, 'https://x.example/'), 'https://x.example/')
        ?.imageUrl,
    ).toBe('https://c.example/s.png')
  })
})

describe('twitterCardLayer', () => {
  const url = 'https://x.example/'
  const page = load('twitter-card-only.html', url)

  it('builds a draft from Twitter Card tags and leaves the handle out of the site name', () => {
    expect(twitterCardLayer(page, url)).toEqual({
      layer: 'twitter-card',
      title: 'Launch notes, week 42',
      description: 'What shipped, what slipped.',
      siteName: null,
      kind: 'website',
      imageUrl: 'https://cdn.example.net/launch.jpg',
      canonicalUrl: null,
    })
  })

  it('reads a player card as video', () => {
    const html =
      '<meta name="twitter:card" content="player"><meta name="twitter:title" content="Clip">'
    expect(twitterCardLayer(extractPageMetadata(html, url), url)?.kind).toBe('video')
  })

  it('answers null when there are no Twitter tags', () => {
    expect(twitterCardLayer(extractPageMetadata('<title>x</title>', url), url)).toBeNull()
  })
})

describe('pageLayer', () => {
  it('prefers JSON-LD over the title and meta description, and calls it an article', () => {
    const url = 'https://news.example.org/a'
    const draft = pageLayer(load('json-ld-only.html', url), url)
    expect(draft).toMatchObject({
      layer: 'page',
      title: 'Council approves the new library',
      description: 'The vote was unanimous.',
      imageUrl: 'https://news.example.org/library.jpg',
      kind: 'article',
    })
  })

  it('falls back to the title and the meta description', () => {
    const html = '<title>Plain</title><meta name="description" content="Just a page.">'
    expect(
      pageLayer(extractPageMetadata(html, 'https://x.example/'), 'https://x.example/'),
    ).toMatchObject({
      title: 'Plain',
      description: 'Just a page.',
      kind: 'website',
      imageUrl: null,
    })
  })

  it('gives a draft with no title for a page that says nothing, which is never rich', () => {
    const draft = pageLayer(
      extractPageMetadata('<p>hi</p>', 'https://x.example/'),
      'https://x.example/',
    )
    expect(draft?.title).toBeNull()
    expect(draft !== null && isRich(draft)).toBe(false)
  })
})

describe('hostile input', () => {
  const url = 'https://evil.example/'
  const page = load('hostile.html', url)

  it('cleans text, drops non-http images, and keeps markup as inert text', () => {
    const draft = openGraphLayer(page, url)
    expect(draft?.title).toBe('goodelgoog.com')
    expect(draft?.description).toBe('line one line two [31m')
    expect(draft?.imageUrl).toBeNull()
  })

  it('reads the title from the document, not from an inline SVG', () => {
    expect(pageLayer(page, url)?.title).toBe('Hostile <img src=x onerror=alert(1)>')
  })
})

describe('MARKUP_LAYERS', () => {
  it('is in the order the ADR tries them', () => {
    expect(MARKUP_LAYERS).toEqual([openGraphLayer, twitterCardLayer, pageLayer])
  })
})
