import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { extractPageMetadata, headMarkup } from './page-metadata.ts'

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')

describe('extractPageMetadata: an article with Open Graph', () => {
  const page = extractPageMetadata(
    fixture('article-open-graph.html'),
    'https://engineering.acme.example/posts/deploy-time?utm_source=x',
  )

  it('reads the title and the meta description', () => {
    expect(page.title).toBe('How we cut deploy time by 80% | Acme Engineering')
    expect(page.description).toBe('Fallback description from the meta tag.')
  })

  it('reads Open Graph properties, decoding entities, first occurrence winning', () => {
    expect(page.openGraph.get('og:title')).toBe('How we cut deploy time by 80%')
    expect(page.openGraph.get('og:description')).toBe('Caching, parallelism & a lot of deleting.')
    expect(page.openGraph.get('og:image')).toBe('/images/deploy-hero.png')
    expect(page.openGraph.get('og:type')).toBe('article')
    expect(page.openGraph.get('og:site_name')).toBe('Acme Engineering')
  })

  it('reads Twitter Card names separately', () => {
    expect(page.twitter.get('twitter:title')).toBe('Twitter title')
    expect(page.twitter.get('twitter:card')).toBe('summary_large_image')
  })

  it('resolves the canonical link', () => {
    expect(page.canonicalUrl).toBe('https://engineering.acme.example/posts/deploy-time')
  })

  it('finds the JSON oEmbed endpoint and ignores the XML one', () => {
    expect(page.oembedUrl).toBe(
      'https://engineering.acme.example/oembed?url=https%3A%2F%2Fengineering.acme.example%2Fposts%2Fdeploy-time&format=json',
    )
  })

  it('ranks icons: the smallest adequate one first, then the rest biggest first; no ico or svg', () => {
    expect(page.icons).toEqual([
      { href: 'https://engineering.acme.example/apple-touch-icon.png', size: 180 },
      { href: 'https://engineering.acme.example/favicon-32.png', size: 32 },
      { href: 'https://engineering.acme.example/favicon-16.png', size: 16 },
    ])
  })
})

describe('extractPageMetadata: other sources', () => {
  it('reads a page that has only Twitter Card tags', () => {
    const page = extractPageMetadata(fixture('twitter-card-only.html'), 'https://x.example/')
    expect(page.openGraph.size).toBe(0)
    expect(page.twitter.get('twitter:title')).toBe('Launch notes, week 42')
    expect(page.twitter.get('twitter:image')).toBe('https://cdn.example.net/launch.jpg')
    expect(page.title).toBe('Fallback title')
  })

  it('reads JSON-LD, searching an @graph for the node that has a headline', () => {
    const page = extractPageMetadata(fixture('json-ld-only.html'), 'https://news.example.org/a')
    expect(page.jsonLd).toEqual({
      headline: 'Council approves the new library',
      description: 'The vote was unanimous.',
      image: 'https://news.example.org/library.jpg',
    })
  })

  it('answers empty metadata for a page that says nothing', () => {
    const page = extractPageMetadata(
      '<html><head></head><body>hi</body></html>',
      'https://x.example/',
    )
    expect(page).toMatchObject({
      title: null,
      description: null,
      canonicalUrl: null,
      oembedUrl: null,
      jsonLd: null,
    })
    expect(page.openGraph.size).toBe(0)
    expect(page.icons).toEqual([])
  })

  it('copes with a document cut off mid-tag, as a truncated read leaves it', () => {
    const page = extractPageMetadata(
      '<head><title>Cut</title><meta property="og:title" cont',
      'https://x.example/',
    )
    expect(page.title).toBe('Cut')
  })

  it('reads attributes in any order and quoting', () => {
    const page = extractPageMetadata(
      "<head><META CONTENT='Odd' Property=OG:TITLE><link href=/c rel='CANONICAL'></head>",
      'https://x.example/dir/page',
    )
    expect(page.openGraph.get('og:title')).toBe('Odd')
    expect(page.canonicalUrl).toBe('https://x.example/c')
  })
})

describe('extractPageMetadata: a hostile page', () => {
  const page = extractPageMetadata(fixture('hostile.html'), 'https://evil.example/')

  it('returns markup as inert text, to be cleaned and escaped downstream', () => {
    expect(page.title).toBe('Hostile <img src=x onerror=alert(1)>')
  })

  it('does not read a title from inside an SVG', () => {
    expect(page.title).not.toBe('svg title')
  })

  it('does not read tags that live in noscript', () => {
    expect(page.openGraph.get('og:title')).toBe('goodelgoog.com')
  })

  it('discards icons and canonical links that are not http(s)', () => {
    expect(page.icons).toEqual([])
    expect(page.canonicalUrl).toBeNull()
  })

  it('survives malformed JSON-LD', () => {
    expect(page.jsonLd).toBeNull()
  })

  it('leaves an image URL for the image pipeline to refuse, as raw text', () => {
    expect(page.openGraph.get('og:image')).toBe('javascript:alert(1)')
  })
})

const read = (head: string) => extractPageMetadata(`<head>${head}</head>`, 'https://x.example/')

describe('extractPageMetadata: edge cases', () => {
  it('discards a link whose URL cannot be parsed', () => {
    expect(read('<link rel="canonical" href="http://[bad">').canonicalUrl).toBeNull()
  })

  it('reads a JSON-LD image given as a string, a list, or an object with a url, and no other', () => {
    const ld = (image: string) =>
      read(`<script type="application/ld+json">{"headline":"H","image":${image}}</script>`).jsonLd
    expect(ld('5')?.image).toBeNull()
    expect(ld('["https://a.example/i.png"]')?.image).toBe('https://a.example/i.png')
    expect(ld('{"url":"https://a.example/o.png"}')?.image).toBe('https://a.example/o.png')
  })

  it('finds no article in JSON-LD that has none, or that nests too deeply', () => {
    const ld = (json: string) => read(`<script type="application/ld+json">${json}</script>`).jsonLd
    expect(ld('[{"name":"x"}, 3]')).toBeNull()
    expect(
      ld(
        '{"@graph":[{"@graph":[{"@graph":[{"@graph":[{"@graph":[{"headline":"too deep"}]}]}]}]}]}',
      ),
    ).toBeNull()
    expect(ld('"just a string"')).toBeNull()
  })

  it('keeps the first of repeated tags, and ignores empty ones', () => {
    const page = read(
      '<meta name="description" content="first"><meta name="description" content="second"><meta property="og:title" content="  "><meta property="og:title" content="real">',
    )
    expect(page.description).toBe('first')
    expect(page.openGraph.get('og:title')).toBe('real')
  })

  it('reads only the first JSON-LD block', () => {
    const page = read(
      '<script type="application/ld+json">{"headline":"First"}</script><script type="application/ld+json">{"headline":"Second"}</script>',
    )
    expect(page.jsonLd?.headline).toBe('First')
  })

  it('reads Twitter tags written with property, as many pages do', () => {
    expect(read('<meta property="twitter:title" content="T">').twitter.get('twitter:title')).toBe(
      'T',
    )
  })

  it('ranks icons that declare no size after those that do, and caps the candidates', () => {
    const page = read(
      '<link rel="icon" href="/a.png"><link rel="icon" href="/b.png" sizes="128x128"><link rel="icon" href="/c.png" sizes="16x16"><link rel="icon" href="/d.png" sizes="96x96">',
    )
    expect(page.icons.map((icon) => icon.href)).toEqual([
      'https://x.example/d.png',
      'https://x.example/b.png',
      'https://x.example/c.png',
    ])
  })
})

describe('extractPageMetadata: pages built to hurt the parser', () => {
  it('does not spend seconds on a body of deeply nested elements', () => {
    const html = `<head><title>Fine</title></head><body>${'<div>'.repeat(100_000)}`
    const before = performance.now()
    expect(extractPageMetadata(html, 'https://x.example/').title).toBe('Fine')
    // A generous bound: the attack it guards against takes tens of seconds, and a busy machine takes one.
    expect(performance.now() - before).toBeLessThan(3000)
  })

  it('does not spend seconds on nesting that never closes the head', () => {
    const html = `<title>Fine</title>${'<div>'.repeat(100_000)}`
    const before = performance.now()
    expect(extractPageMetadata(html, 'https://x.example/').title).toBe('Fine')
    // A generous bound: the attack it guards against takes tens of seconds, and a busy machine takes one.
    expect(performance.now() - before).toBeLessThan(3000)
  })

  it('does not spend seconds on nested templates inside the head', () => {
    const html = `<head><title>Fine</title>${'<template>'.repeat(100_000)}`
    const before = performance.now()
    expect(extractPageMetadata(html, 'https://x.example/').title).toBe('Fine')
    // A generous bound: the attack it guards against takes tens of seconds, and a busy machine takes one.
    expect(performance.now() - before).toBeLessThan(3000)
  })
})

describe('headMarkup', () => {
  it('stops at the end of the head, in any case', () => {
    expect(headMarkup('<title>T</title></HEAD><body>x')).toBe('<title>T</title>')
  })

  it('stops at the start of the body when the head is never closed', () => {
    expect(headMarkup('<title>T</title><BODY class=x>x')).toBe('<title>T</title>')
  })

  it('keeps a page with neither whole', () => {
    expect(headMarkup('<title>T</title>')).toBe('<title>T</title>')
  })

  it('cuts at the tag limit', () => {
    const cut = headMarkup('<meta>'.repeat(5000))
    expect(cut.length).toBe(6 * 2000)
  })
})
