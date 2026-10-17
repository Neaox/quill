import { readFileSync } from 'node:fs'
import { createFakeClock, createInMemoryBlobStore } from '@quill/application/test-support'
import { compileLinkPolicy, createEmbedRegistry } from '@quill/domain'
import type { CompiledLinkPolicy, LinkPreviewPolicy, PreviewImage } from '@quill/domain'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OpenWebReader, OpenWebRequest, OpenWebResponse } from '../http/open-web-client.ts'
import { OutboundRequestError } from '../http/outbound-client.ts'
import { createImageIngestor } from './image-ingestor.ts'
import type { ImageIngestor } from './image-ingestor.ts'
import { createLinkPreviewProvider } from './link-preview-provider.ts'
import { createOembedRegistry } from './oembed-registry.ts'
import { createSharpTranscoder } from './sharp-transcoder.ts'

const EMBEDS = createEmbedRegistry([])
const NOW = new Date('2026-10-13T09:00:00.000Z')
const encoder = new TextEncoder()

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')

function page(
  url: string,
  html: string,
  overrides: Partial<OpenWebResponse> = {},
): OpenWebResponse {
  return {
    status: 200,
    url,
    mediaType: 'text/html',
    charset: null,
    body: encoder.encode(html),
    truncated: false,
    ...overrides,
  }
}

function json(url: string, value: unknown): OpenWebResponse {
  return page(url, JSON.stringify(value), { mediaType: 'application/json' })
}

type Route = OpenWebResponse | OutboundRequestError

/** A reader that serves a table of URLs, and records what was asked for. */
function fakeReader(routes: Record<string, Route>) {
  const get = vi.fn<OpenWebReader['get']>(async (request: OpenWebRequest) => {
    const route = routes[request.url]
    if (route === undefined)
      throw new OutboundRequestError('dns_failure', `No route for ${request.url}`)
    if (route instanceof OutboundRequestError) throw route
    return route
  })
  return { reader: { get }, get, asked: () => get.mock.calls.map(([request]) => request.url) }
}

/** An ingestor that stores nothing and names each image after its URL. */
function fakeImages(failing: readonly string[] = []) {
  const ingest = vi.fn<ImageIngestor['ingest']>(async (url) =>
    failing.includes(url)
      ? null
      : { hash: `hash:${url}`, width: 640, height: 336, mediaType: 'image/webp' },
  )
  return { images: { ingest }, ingest }
}

const REGISTRY = createOembedRegistry([
  {
    name: 'Vimeo',
    endpoint: 'https://vimeo.com/api/oembed.json',
    schemes: ['https://vimeo.com/*'],
  },
])

function setUp(routes: Record<string, Route>, failingImages: readonly string[] = []) {
  const served = fakeReader(routes)
  const images = fakeImages(failingImages)
  const provider = createLinkPreviewProvider({
    reader: served.reader,
    images: images.images,
    oembed: REGISTRY,
    embeds: EMBEDS,
    clock: createFakeClock(NOW),
  })
  return { provider, ...served, ...images }
}

const ARTICLE = 'https://engineering.acme.example/posts/deploy-time'

describe('resolve: Open Graph', () => {
  let setup: ReturnType<typeof setUp>
  beforeEach(() => {
    setup = setUp({ [ARTICLE]: page(ARTICLE, fixture('article-open-graph.html')) })
  })

  it('builds a preview from Open Graph, with stored images and the clock', async () => {
    const result = await setup.provider.resolve(ARTICLE)
    expect(result).toEqual({
      ok: true,
      value: {
        url: ARTICLE,
        canonicalUrl: ARTICLE,
        title: 'How we cut deploy time by 80%',
        description: 'Caching, parallelism & a lot of deleting.',
        siteName: 'Acme Engineering',
        kind: 'article',
        thumbnail: expect.objectContaining({
          hash: 'hash:https://engineering.acme.example/images/deploy-hero.png',
        }),
        favicon: expect.objectContaining({
          hash: 'hash:https://engineering.acme.example/apple-touch-icon.png',
        }),
        layer: 'open-graph',
        fetchedAt: '2026-10-13T09:00:00.000Z',
      },
    })
  })

  it('stops at the first rich layer: one fetch, and no oEmbed request though the page advertises one', async () => {
    await setup.provider.resolve(ARTICLE)
    expect(setup.asked()).toEqual([ARTICLE])
  })

  it('keys the preview by the normalised URL, not by what was pasted', async () => {
    const result = await setup.provider.resolve(
      `${ARTICLE.toUpperCase().replace('/POSTS/DEPLOY-TIME', '/posts/deploy-time')}?utm_source=x#top`,
    )
    expect(result.ok && result.value.url).toBe(ARTICLE)
  })

  it('fetches the thumbnail and the favicon at their own sizes', async () => {
    await setup.provider.resolve(ARTICLE)
    const specs = Object.fromEntries(
      setup.ingest.mock.calls.map(([url, spec]) => [url, spec.maxWidth]),
    )
    expect(specs).toEqual({
      'https://engineering.acme.example/images/deploy-hero.png': 640,
      'https://engineering.acme.example/apple-touch-icon.png': 64,
    })
  })

  it('keeps the text when an image fails', async () => {
    const failing = setUp({ [ARTICLE]: page(ARTICLE, fixture('article-open-graph.html')) }, [
      'https://engineering.acme.example/images/deploy-hero.png',
    ])
    const result = await failing.provider.resolve(ARTICLE)
    expect(result.ok && result.value).toMatchObject({
      title: 'How we cut deploy time by 80%',
      thumbnail: null,
    })
  })

  it('tries the next icon when the first cannot be used', async () => {
    const failing = setUp({ [ARTICLE]: page(ARTICLE, fixture('article-open-graph.html')) }, [
      'https://engineering.acme.example/apple-touch-icon.png',
    ])
    const result = await failing.provider.resolve(ARTICLE)
    expect(result.ok && result.value.favicon?.hash).toBe(
      'hash:https://engineering.acme.example/favicon-32.png',
    )
  })
})

describe('resolve: the other layers', () => {
  it('falls through to Twitter Card tags', async () => {
    const url = 'https://x.example/launch'
    const { provider } = setUp({ [url]: page(url, fixture('twitter-card-only.html')) })
    const result = await provider.resolve(url)
    expect(result.ok && result.value).toMatchObject({
      layer: 'twitter-card',
      title: 'Launch notes, week 42',
      siteName: 'x.example',
    })
  })

  it('falls through to JSON-LD and the page tags', async () => {
    const url = 'https://news.example.org/library'
    const { provider } = setUp({ [url]: page(url, fixture('json-ld-only.html')) })
    const result = await provider.resolve(url)
    expect(result.ok && result.value).toMatchObject({
      layer: 'page',
      title: 'Council approves the new library',
      kind: 'article',
    })
  })

  it('uses a bare title when nothing richer exists, rather than nothing', async () => {
    const url = 'https://plain.example/'
    const { provider } = setUp({ [url]: page(url, '<title>Just a title</title>') })
    const result = await provider.resolve(url)
    expect(result.ok && result.value).toMatchObject({
      layer: 'page',
      title: 'Just a title',
      description: null,
      thumbnail: null,
    })
  })

  it('names the host when the page does not name itself, without www', async () => {
    const url = 'https://www.plain.example/'
    const { provider } = setUp({ [url]: page(url, '<title>T</title>') })
    const result = await provider.resolve(url)
    expect(result.ok && result.value.siteName).toBe('plain.example')
  })

  it('answers no_metadata for a page that says nothing', async () => {
    const url = 'https://blank.example/'
    const { provider } = setUp({ [url]: page(url, '<p>hi</p>') })
    expect(await provider.resolve(url)).toEqual({ ok: false, error: 'no_metadata' })
  })

  it('decodes a page in its declared charset', async () => {
    const url = 'https://latin.example/'
    const bytes = Uint8Array.from([
      ...encoder.encode('<title>caf'),
      0xe9,
      ...encoder.encode('</title>'),
    ])
    const { provider } = setUp({ [url]: page(url, '', { body: bytes, charset: 'iso-8859-1' }) })
    const result = await provider.resolve(url)
    expect(result.ok && result.value.title).toBe('café')
  })
})

describe('resolve: oEmbed', () => {
  const VIDEO = 'https://vimeo.com/76979871'
  const ENDPOINT = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(VIDEO)}&format=json`
  const richVideo = {
    type: 'video',
    title: 'A short film',
    provider_name: 'Vimeo',
    thumbnail_url: 'https://i.vimeocdn.com/t.jpg',
    html: '<iframe src="https://evil.example"></iframe>',
  }

  it('asks a known provider first, and never fetches the page when it is rich', async () => {
    const { provider, asked } = setUp({ [ENDPOINT]: json(ENDPOINT, richVideo) })
    const result = await provider.resolve(VIDEO)
    expect(asked()).toEqual([ENDPOINT])
    expect(result.ok && result.value).toMatchObject({
      layer: 'oembed',
      title: 'A short film',
      siteName: 'Vimeo',
      kind: 'video',
      thumbnail: expect.objectContaining({ hash: 'hash:https://i.vimeocdn.com/t.jpg' }),
      favicon: null,
    })
  })

  it('never carries the provider html into the preview', async () => {
    const { provider } = setUp({ [ENDPOINT]: json(ENDPOINT, richVideo) })
    expect(JSON.stringify(await provider.resolve(VIDEO))).not.toContain('iframe')
  })

  it('goes on to the page when the provider gives only a title', async () => {
    const { provider, asked } = setUp({
      [ENDPOINT]: json(ENDPOINT, { type: 'video', title: 'Only a title' }),
      [VIDEO]: page(
        VIDEO,
        '<meta property="og:title" content="From the page"><meta property="og:image" content="https://i.example/p.jpg">',
      ),
    })
    const result = await provider.resolve(VIDEO)
    expect(asked()).toEqual([ENDPOINT, VIDEO])
    expect(result.ok && result.value).toMatchObject({ layer: 'open-graph', title: 'From the page' })
  })

  it('uses the provider title when the page itself cannot be had', async () => {
    const { provider } = setUp({
      [ENDPOINT]: json(ENDPOINT, { type: 'video', title: 'Only a title', provider_name: 'Vimeo' }),
      [VIDEO]: page(VIDEO, '', { status: 403 }),
    })
    const result = await provider.resolve(VIDEO)
    expect(result.ok && result.value).toMatchObject({ layer: 'oembed', title: 'Only a title' })
  })

  it('moves on when the provider endpoint fails, or answers nonsense', async () => {
    const failing = setUp({
      [ENDPOINT]: new OutboundRequestError('timeout', 'slow'),
      [VIDEO]: page(VIDEO, '<title>Fallback</title>'),
    })
    expect((await failing.provider.resolve(VIDEO)).ok).toBe(true)
    const nonsense = setUp({
      [ENDPOINT]: page(ENDPOINT, 'not json', { mediaType: 'application/json' }),
      [VIDEO]: page(VIDEO, '<title>Fallback</title>'),
    })
    const result = await nonsense.provider.resolve(VIDEO)
    expect(result.ok && result.value.title).toBe('Fallback')
  })

  it('uses a discovered endpoint only when the markup was not rich', async () => {
    const url = 'https://blog.example/post'
    const discovered = 'https://blog.example/oembed?format=json'
    const html = `<title>Post</title><link rel="alternate" type="application/json+oembed" href="${discovered}">`
    const { provider, asked } = setUp({
      [url]: page(url, html),
      [discovered]: json(discovered, {
        type: 'link',
        title: 'Post (oEmbed)',
        provider_name: 'Blog',
        thumbnail_url: 'https://blog.example/t.png',
      }),
    })
    const result = await provider.resolve(url)
    expect(asked()).toEqual([url, discovered])
    expect(result.ok && result.value).toMatchObject({ layer: 'oembed', title: 'Post (oEmbed)' })
  })

  it('uses a discovered endpoint that gives only a title, when nothing richer exists', async () => {
    const url = 'https://blog.example/post'
    const discovered = 'https://blog.example/oembed?format=json'
    const html = `<link rel="alternate" type="application/json+oembed" href="${discovered}">`
    const { provider } = setUp({
      [url]: page(url, html),
      [discovered]: json(discovered, { type: 'link', title: 'Only a title' }),
    })
    const result = await provider.resolve(url)
    expect(result.ok && result.value).toMatchObject({ layer: 'oembed', title: 'Only a title' })
  })

  it('ignores an oEmbed answer that is not an object, or not a success', async () => {
    const url = 'https://blog.example/post'
    const discovered = 'https://blog.example/oembed?format=json'
    const html = `<title>Page</title><link rel="alternate" type="application/json+oembed" href="${discovered}">`
    const answers = [
      json(discovered, ['a']),
      json(discovered, 'text'),
      page(discovered, '{}', { status: 500, mediaType: 'application/json' }),
    ]
    for (const answer of answers) {
      const { provider } = setUp({ [url]: page(url, html), [discovered]: answer })
      // eslint-disable-next-line no-await-in-loop -- each case builds its own provider.
      const result = await provider.resolve(url)
      expect(result.ok && result.value).toMatchObject({ layer: 'page', title: 'Page' })
    }
  })

  it('treats a photo as an image whose thumbnail is the photo', async () => {
    const photo = 'https://vimeo.com/photo'
    const endpoint = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(photo)}&format=json`
    const { provider } = setUp({
      [endpoint]: json(endpoint, {
        type: 'photo',
        title: 'Sunset',
        url: 'https://cdn.example/sunset.jpg',
      }),
    })
    const result = await provider.resolve(photo)
    expect(result.ok && result.value).toMatchObject({
      kind: 'image',
      thumbnail: expect.objectContaining({ hash: 'hash:https://cdn.example/sunset.jpg' }),
    })
  })
})

describe('resolve: addresses and canonical links', () => {
  it('believes a canonical link on the same site and follows a redirect for the address', async () => {
    const short = 'https://short.example/abc'
    const landed = 'https://www.acme.example/posts/full'
    const html =
      '<meta property="og:title" content="T"><meta property="og:description" content="D"><link rel="canonical" href="/posts/full">'
    const { provider } = setUp({ [short]: page(landed, html) })
    const result = await provider.resolve(short)
    expect(result.ok && result.value).toMatchObject({ url: short, canonicalUrl: landed })
  })

  it('falls back to where the page ended up when its same-site canonical link cannot be a key', async () => {
    const url = 'https://blog.example/post'
    const html =
      '<meta property="og:title" content="T"><meta property="og:description" content="D"><link rel="canonical" href="https://u:p@blog.example/post">'
    const { provider } = setUp({ [url]: page(url, html) })
    const result = await provider.resolve(url)
    expect(result.ok && result.value.canonicalUrl).toBe(url)
  })

  it('does not believe a canonical link that points at another site', async () => {
    const url = 'https://blog.example/post'
    const html =
      '<meta property="og:title" content="T"><meta property="og:description" content="D"><link rel="canonical" href="https://bank.example/login">'
    const { provider } = setUp({ [url]: page(url, html) })
    const result = await provider.resolve(url)
    expect(result.ok && result.value.canonicalUrl).toBe(url)
  })

  it('resolves relative images against where the page ended up, not where the link pointed', async () => {
    const short = 'https://short.example/abc'
    const landed = 'https://cdn.acme.example/posts/full/'
    const html =
      '<meta property="og:title" content="T"><meta property="og:image" content="cover.png">'
    const { provider, ingest } = setUp({ [short]: page(landed, html) })
    await provider.resolve(short)
    expect(ingest.mock.calls[0]?.[0]).toBe('https://cdn.acme.example/posts/full/cover.png')
  })
})

describe('resolve: failures are values', () => {
  const url = 'https://down.example/'

  it.each([
    ['a missing page', page(url, '', { status: 404 }), 'not_a_page'],
    ['a gone page', page(url, '', { status: 410 }), 'not_a_page'],
    ['a refusal', page(url, '', { status: 403 }), 'unreachable'],
    ['throttling', page(url, '', { status: 429 }), 'unreachable'],
    ['a server error', page(url, '', { status: 503 }), 'unreachable'],
    ['a JSON answer', page(url, '{}', { mediaType: 'application/json' }), 'not_a_page'],
    ['a download', new OutboundRequestError('content_type_not_allowed', 'pdf'), 'not_a_page'],
    ['a giant image', new OutboundRequestError('response_too_large', 'big'), 'not_a_page'],
    ['a timeout', new OutboundRequestError('timeout', 'slow'), 'unreachable'],
    ['a private address', new OutboundRequestError('private_address', 'inside'), 'unreachable'],
    ['a DNS failure', new OutboundRequestError('dns_failure', 'gone'), 'unreachable'],
    ['a redirect loop', new OutboundRequestError('too_many_redirects', 'loop'), 'unreachable'],
    [
      'a port that is not allowed',
      new OutboundRequestError('port_not_allowed', '8080'),
      'invalid_url',
    ],
    ['an unexpected error', new OutboundRequestError('network_error', 'reset'), 'unreachable'],
  ])('maps %s to %s', async (_name, route, failure) => {
    const { provider } = setUp({ [url]: route })
    expect(await provider.resolve(url)).toEqual({ ok: false, error: failure })
  })

  it.each([['not a url'], ['ftp://example.com/x'], ['https://user:pw@example.com/'], ['']])(
    'refuses %s without fetching',
    async (raw) => {
      const { provider, get } = setUp({})
      expect(await provider.resolve(raw)).toEqual({ ok: false, error: 'invalid_url' })
      expect(get).not.toHaveBeenCalled()
    },
  )

  it('treats a non-OutboundRequestError from the reader as unreachable rather than throwing', async () => {
    const reader: OpenWebReader = {
      get: async () => {
        throw new Error('boom')
      },
    }
    const provider = createLinkPreviewProvider({
      reader,
      images: fakeImages().images,
      oembed: REGISTRY,
      embeds: EMBEDS,
      clock: createFakeClock(NOW),
    })
    expect(await provider.resolve(url)).toEqual({ ok: false, error: 'unreachable' })
  })
})

const png = async (width: number, height: number) =>
  new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: '#c33' } })
      .png()
      .toBuffer(),
  )

describe('resolve: end to end with real images', () => {
  it('fetches, re-encodes and stores the thumbnail and the favicon', async () => {
    const url = 'https://real.example/post'
    const html =
      '<meta property="og:title" content="Real"><meta property="og:image" content="https://real.example/og.png"><link rel="icon" sizes="256x256" href="/icon.png">'
    const routes: Record<string, Route> = {
      [url]: page(url, html),
      'https://real.example/og.png': page('https://real.example/og.png', '', {
        mediaType: 'image/png',
        body: await png(1200, 630),
      }),
      'https://real.example/icon.png': page('https://real.example/icon.png', '', {
        mediaType: 'image/png',
        body: await png(256, 256),
      }),
    }
    const blobs = createInMemoryBlobStore()
    const { reader } = fakeReader(routes)
    const provider = createLinkPreviewProvider({
      reader,
      images: createImageIngestor({ reader, transcoder: createSharpTranscoder(), blobs }),
      oembed: REGISTRY,
      embeds: EMBEDS,
      clock: createFakeClock(NOW),
    })
    const result = await provider.resolve(url)
    const value = result.ok ? result.value : null
    expect(value?.thumbnail).toMatchObject({ width: 640, height: 336, mediaType: 'image/webp' })
    expect(value?.favicon).toMatchObject({ width: 64, height: 64 })
    const stored: PreviewImage[] = [value?.thumbnail, value?.favicon].filter(
      (image): image is PreviewImage => image != null,
    )
    expect(await Promise.all(stored.map((image) => blobs.has(image.hash)))).toEqual([true, true])
  })
})

function compile(policy: LinkPreviewPolicy): CompiledLinkPolicy {
  const compiled = compileLinkPolicy(policy)
  if (!compiled.ok) throw new Error('policy did not compile')
  return compiled.value
}

describe('resolve: organisation policy', () => {
  const rich = { mode: 'rich', allow: [], block: [] } as const

  /** The reader, as the real one behaves: asks the permit on the first URL. */
  function permittingReader(routes: Record<string, Route>) {
    const served = fakeReader(routes)
    const get = vi.fn<OpenWebReader['get']>(async (request) => {
      if (request.permit !== undefined && !request.permit(new URL(request.url))) {
        throw new OutboundRequestError('blocked_by_policy', request.url)
      }
      return served.reader.get(request)
    })
    return { reader: { get }, get, asked: served.asked }
  }

  function withPolicy(routes: Record<string, Route>) {
    const served = permittingReader(routes)
    const images = fakeImages()
    const provider = createLinkPreviewProvider({
      reader: served.reader,
      images: images.images,
      oembed: REGISTRY,
      embeds: EMBEDS,
      clock: createFakeClock(NOW),
    })
    return { provider, ...served, ...images }
  }

  it('fetches nothing at all when previews are off', async () => {
    const { provider, get } = withPolicy({
      [ARTICLE]: page(ARTICLE, fixture('article-open-graph.html')),
    })
    expect(await provider.resolve(ARTICLE, { policy: compile({ ...rich, mode: 'off' }) })).toEqual({
      ok: false,
      error: 'blocked',
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('refuses a blocked host before contacting anyone, including a provider endpoint', async () => {
    const video = 'https://vimeo.com/private/1'
    const { provider, get } = withPolicy({})
    const policy = compile({ ...rich, block: ['vimeo.com/private'] })
    expect(await provider.resolve(video, { policy })).toEqual({ ok: false, error: 'blocked' })
    expect(get).not.toHaveBeenCalled()
  })

  it('keeps the text but drops an image on a host the policy does not allow', async () => {
    const { provider, ingest } = withPolicy({
      [ARTICLE]: page(ARTICLE, fixture('article-open-graph.html')),
    })
    const policy = compile({ ...rich, allow: ['engineering.acme.example'] })
    const result = await provider.resolve(ARTICLE, { policy })
    expect(result.ok && result.value).toMatchObject({ title: 'How we cut deploy time by 80%' })
    // Every image goes through the same permit, which the image fetch would apply.
    const permit = ingest.mock.calls[0]?.[2]
    expect(permit?.(new URL('https://engineering.acme.example/i.png'))).toBe(true)
    expect(permit?.(new URL('https://tracker.example/i.png'))).toBe(false)
  })

  it('reports a redirect to a blocked host as blocked', async () => {
    const short = 'https://short.example/abc'
    const served = fakeReader({})
    const get = vi.fn<OpenWebReader['get']>(async () => {
      throw new OutboundRequestError('blocked_by_policy', 'redirect target')
    })
    const provider = createLinkPreviewProvider({
      reader: { get },
      images: fakeImages().images,
      oembed: REGISTRY,
      embeds: EMBEDS,
      clock: createFakeClock(NOW),
    })
    expect(served.get).not.toHaveBeenCalled()
    expect(await provider.resolve(short, { policy: compile(rich) })).toEqual({
      ok: false,
      error: 'blocked',
    })
  })

  it('fetches no pictures in text mode, and says so to the image step', async () => {
    const { provider, ingest } = withPolicy({
      [ARTICLE]: page(ARTICLE, fixture('article-open-graph.html')),
    })
    const result = await provider.resolve(ARTICLE, { policy: compile({ ...rich, mode: 'text' }) })
    expect(result.ok && result.value).toMatchObject({
      title: 'How we cut deploy time by 80%',
      thumbnail: null,
      favicon: null,
    })
    expect(ingest).not.toHaveBeenCalled()
  })

  it('hands the policy to the oEmbed request too', async () => {
    const url = 'https://blog.example/post'
    const discovered = 'https://oembed.elsewhere.example/o?format=json'
    const html = `<title>Page</title><link rel="alternate" type="application/json+oembed" href="${discovered}">`
    const { provider, asked } = withPolicy({
      [url]: page(url, html),
      [discovered]: json(discovered, {
        type: 'link',
        title: 'From elsewhere',
        thumbnail_url: 'https://x.example/t.png',
      }),
    })
    const policy = compile({ ...rich, allow: ['blog.example'] })
    const result = await provider.resolve(url, { policy })
    expect(asked()).toEqual([url])
    expect(result.ok && result.value).toMatchObject({ layer: 'page', title: 'Page' })
  })

  it('reports a busy client as busy, which is not a verdict on the link', async () => {
    const reader: OpenWebReader = {
      get: async () => {
        throw new OutboundRequestError('too_busy', 'queue full')
      },
    }
    const provider = createLinkPreviewProvider({
      reader,
      images: fakeImages().images,
      oembed: REGISTRY,
      embeds: EMBEDS,
      clock: createFakeClock(NOW),
    })
    expect(await provider.resolve('https://busy.example/')).toEqual({ ok: false, error: 'busy' })
  })
})

describe('resolve: embeds (ADR-042, "Embeds are an allowlist")', () => {
  const video = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const embed = {
    provider: 'youtube',
    src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    aspectRatio: 16 / 9,
  }

  function resolverFor(embeds = EMBEDS, routes: Record<string, Route> = {}) {
    const served = fakeReader({
      [video]: page(video, fixture('article-open-graph.html')),
      [ARTICLE]: page(ARTICLE, fixture('article-open-graph.html')),
      ...routes,
    })
    return createLinkPreviewProvider({
      reader: served.reader,
      images: fakeImages().images,
      oembed: REGISTRY,
      embeds,
      clock: createFakeClock(NOW),
    })
  }
  const policy = (mode: 'off' | 'text' | 'rich') => compile({ mode, allow: [], block: [] })

  it('records the frame for a page of an allowlisted provider', async () => {
    const result = await resolverFor().resolve(video, { policy: policy('rich') })
    expect(result.ok && result.value.embed).toEqual(embed)
  })

  it('records it when no policy is given, which is the default policy, rich', async () => {
    const result = await resolverFor().resolve(video)
    expect(result.ok && result.value.embed).toEqual(embed)
  })

  it('never records one under a text-only policy', async () => {
    const result = await resolverFor().resolve(video, { policy: policy('text') })
    expect(result.ok && result.value).toMatchObject({ title: expect.any(String) })
    expect(result.ok && 'embed' in result.value).toBe(false)
  })

  it('makes no preview at all when previews are off', async () => {
    expect(await resolverFor().resolve(video, { policy: policy('off') })).toEqual({
      ok: false,
      error: 'blocked',
    })
  })

  it('records none for a page that is not on the allowlist', async () => {
    const result = await resolverFor().resolve(ARTICLE, { policy: policy('rich') })
    expect(result.ok && 'embed' in result.value).toBe(false)
  })

  it('records none for a provider the operator has switched off', async () => {
    const result = await resolverFor(createEmbedRegistry(['youtube'])).resolve(video)
    expect(result.ok && 'embed' in result.value).toBe(false)
  })

  it('takes the frame from the address, never from what the page says', async () => {
    const hostile = `<title>Hostile</title><meta property="og:description" content="d">
      <meta property="og:video:url" content="https://evil.example/frame">
      <link rel="alternate" type="application/json+oembed" href="https://evil.example/o.json">`
    const result = await resolverFor(EMBEDS, { [video]: page(video, hostile) }).resolve(video)
    expect(result.ok && result.value.embed).toEqual(embed)
  })
})
