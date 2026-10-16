import { describe, expect, it } from 'vitest'
import type { ExtractedText, PublicNavigationNode } from '@quill/application'
import type { DocumentId } from '@quill/domain'

import {
  articleStructuredData,
  DESCRIPTION_MAX_LENGTH,
  firstParagraph,
  renderDocumentMain,
  renderIndexMain,
  renderBotPage,
  renderNotFoundMain,
  renderSearchMain,
  renderSnippet,
  unwrapArticle,
} from './pages.ts'
import { OPEN_WEB_LIMITS } from '../infrastructure/http/open-web-client.ts'
import { DEFAULT_RATE_LIMITS } from '../infrastructure/link-preview/rate-limits.ts'

const node = (title: string, path: string): PublicNavigationNode => ({
  documentId: path as DocumentId,
  title,
  path,
  children: [],
})

const text = (body: string): ExtractedText => ({ title: 'A page', headings: [], body })

describe('the document page', () => {
  it('replaces the renderer’s article with the reading grid, so breakout blocks still span it', () => {
    const main = renderDocumentMain({
      collectionName: 'Guides',
      title: 'Rate limits',
      bodyHtml: '<article><h1>Rate limits</h1><div class="layout-wide">wide</div></article>',
      rules: 'hairline',
    })
    expect(main.value).toContain('<article class="layout-grid prose" data-rules="hairline">')
    expect(main.value).toContain('<div class="layout-wide">wide</div>')
    expect(main.value).not.toContain('<article><h1>')
  })

  it('names the collection above the title, inside the grid where the title is', () => {
    const main = renderDocumentMain({
      collectionName: 'Guides',
      title: 'Rate limits',
      bodyHtml: '<article><h1>Rate limits</h1><p>Body</p></article>',
      rules: 'hairline',
    }).value
    expect(main).toMatch(/<p class="site-eyebrow">Guides<\/p>\s*<h1>Rate limits<\/h1>/u)
    expect(main.indexOf('site-eyebrow')).toBeGreaterThan(main.indexOf('<article'))
  })

  it('puts the eyebrow above the title it supplies, when the body has none', () => {
    const main = renderDocumentMain({
      collectionName: 'Guides',
      title: 'Rate limits',
      bodyHtml: '<article><h2>Only a section</h2></article>',
      rules: 'hairline',
    }).value
    expect(main).toMatch(/<p class="site-eyebrow">Guides<\/p>\s*<h1>Rate limits<\/h1>/u)
  })

  /**
   * A short paragraph written immediately before the title is the author's
   * own eyebrow (`prose.css` styles it), and two eyebrows would be one too
   * many — the author's wins.
   */
  it('leaves the eyebrow to the author when the body already has one', () => {
    const main = renderDocumentMain({
      collectionName: 'Guides',
      title: 'The sync map',
      bodyHtml: '<article><p>Overview</p>\n<h1 id="x">The sync map</h1><p>Lede</p></article>',
      rules: 'hairline',
    }).value
    expect(main).not.toContain('site-eyebrow')
    expect(main).toContain('<p>Overview</p>')
  })

  it('still adds one when the paragraph before the title is not the first thing', () => {
    const main = renderDocumentMain({
      collectionName: 'Guides',
      title: 'A page',
      bodyHtml: '<article><h1>A page</h1><p>Lede</p><h1>Another</h1></article>',
      rules: 'hairline',
    }).value
    expect(main).toContain('site-eyebrow')
  })

  it('escapes the collection name, which an administrator typed', () => {
    const main = renderDocumentMain({
      collectionName: '<script>',
      title: 'A page',
      bodyHtml: '<article></article>',
      rules: 'cards',
    })
    expect(main.value).toContain('&lt;script&gt;')
  })
})

describe('unwrapArticle', () => {
  it('unwraps the renderer’s own article', () => {
    expect(unwrapArticle('<article><p>x</p></article>')).toBe('<p>x</p>')
  })

  it('leaves a body that is not shaped that way alone', () => {
    expect(unwrapArticle('<p>x</p>')).toBe('<p>x</p>')
    expect(unwrapArticle('<article><p>x</p></article><p>y</p>')).toBe(
      '<article><p>x</p></article><p>y</p>',
    )
  })
})

describe('the site index', () => {
  it('lists the top level of the navigation', () => {
    const main = renderIndexMain({
      siteSlug: 'acme-docs',
      title: 'Guides',
      navigation: [node('Overview', 'guides/overview')],
    })
    expect(main.value).toContain('<h1>Guides</h1>')
    expect(main.value).toContain('href="/s/acme-docs/guides/overview"')
  })

  it('says so when nothing has been published', () => {
    const main = renderIndexMain({ siteSlug: 'acme-docs', title: 'Guides', navigation: [] })
    expect(main.value).toContain('Nothing has been published here yet.')
  })
})

describe('the search results', () => {
  const snippet = { text: 'A rate limit of 100 a minute.', ranges: [{ start: 2, end: 12 }] }

  it('counts the results and links each one', () => {
    const main = renderSearchMain({
      siteSlug: 'acme-docs',
      query: 'rate limit',
      results: [{ title: 'Rate limits', path: 'guides/rate-limits', snippet }],
    })
    expect(main.value).toContain('1 result for')
    expect(main.value).toContain('href="/s/acme-docs/guides/rate-limits"')
    expect(main.value).toContain('<mark>rate limit</mark>')
  })

  it('pluralises', () => {
    const main = renderSearchMain({
      siteSlug: 'acme-docs',
      query: 'x',
      results: [
        { title: 'One', path: 'g/one', snippet },
        { title: 'Two', path: 'g/two', snippet },
      ],
    })
    expect(main.value).toContain('2 results for')
  })

  it('says nothing matched, and escapes the query a stranger typed', () => {
    const main = renderSearchMain({
      siteSlug: 'acme-docs',
      query: '<script>alert(1)</script>',
      results: [],
    })
    expect(main.value).toContain('Nothing matched')
    expect(main.value).not.toContain('<script>')
    expect(main.value).toContain('&lt;script&gt;')
  })
})

describe('renderSnippet', () => {
  it('marks the matches and escapes everything between them', () => {
    expect(renderSnippet({ text: 'a <b> c', ranges: [{ start: 2, end: 5 }] }).value).toBe(
      'a <mark>&lt;b&gt;</mark> c',
    )
  })

  it('drops a range that overlaps the one before it, rather than emitting torn markup', () => {
    expect(
      renderSnippet({
        text: 'abcdef',
        ranges: [
          { start: 1, end: 4 },
          { start: 2, end: 5 },
        ],
      }).value,
    ).toBe('a<mark>bcd</mark>ef')
  })

  it('is the plain text when nothing matched', () => {
    expect(renderSnippet({ text: 'nothing', ranges: [] }).value).toBe('nothing')
  })
})

describe('the not-found page', () => {
  it('offers the way back to the top of the site', () => {
    expect(renderNotFoundMain({ siteSlug: 'acme-docs' }).value).toContain('href="/s/acme-docs"')
  })
})

describe('firstParagraph', () => {
  it('is the first line of the extracted prose', () => {
    expect(firstParagraph(text('First paragraph.\nSecond paragraph.'))).toBe('First paragraph.')
  })

  it('skips leading blank lines', () => {
    expect(firstParagraph(text('\n   \nReal text.'))).toBe('Real text.')
  })

  it('is null for a document with no prose at all', () => {
    expect(firstParagraph(text(''))).toBeNull()
    expect(firstParagraph(text('   \n  '))).toBeNull()
  })

  it('cuts a long paragraph at a word, and says it was cut', () => {
    const long = 'word '.repeat(80).trim()
    const cut = firstParagraph(text(long))
    expect(cut).toMatch(/…$/u)
    expect(cut?.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH + 1)
    expect(cut).not.toMatch(/wor…$/u)
  })

  it('cuts mid-word only when the first word is longer than the whole limit', () => {
    const cut = firstParagraph(text('x'.repeat(DESCRIPTION_MAX_LENGTH + 20)))
    expect(cut).toBe(`${'x'.repeat(DESCRIPTION_MAX_LENGTH)}…`)
  })
})

describe('articleStructuredData', () => {
  const updatedAt = new Date('2026-08-15T10:00:00.000Z')

  it('says only what the page already says', () => {
    expect(
      JSON.parse(
        articleStructuredData({
          title: 'Rate limits',
          description: 'A rate limit of 100 a minute.',
          canonical: 'https://docs.example.com/s/acme-docs/guides/rate-limits',
          updatedAt,
          organisationName: 'Acme',
        }),
      ),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Rate limits',
      description: 'A rate limit of 100 a minute.',
      mainEntityOfPage: 'https://docs.example.com/s/acme-docs/guides/rate-limits',
      dateModified: '2026-08-15T10:00:00.000Z',
      publisher: { '@type': 'Organization', name: 'Acme' },
    })
  })

  it('leaves the description out rather than inventing one', () => {
    const data = JSON.parse(
      articleStructuredData({
        title: 'Rate limits',
        description: null,
        canonical: 'https://docs.example.com/s/a/b',
        updatedAt,
        organisationName: 'Acme',
      }),
    ) as Record<string, unknown>
    expect(data).not.toHaveProperty('description')
  })
})

describe('the bot page', () => {
  const view = {
    userAgent: 'ExampleBot/1 (+https://docs.example.com/bot)',
    instanceName: 'Acme Docs',
    limits: { timeoutSeconds: 6, maxRedirects: 5, pageKiB: 512, imageMiB: 5 },
    perHost: { burst: 5, perSecond: 0.5 },
  }

  it('says who is asking, what is fetched, how much and how often, and how to stop it', () => {
    // The template is reflowed source; what matters is the words, not where the line broke.
    const page = renderBotPage(view).replaceAll(/\s+/gu, ' ')
    expect(page).toContain('ExampleBot/1 (+https://docs.example.com/bot)')
    expect(page).toContain('Acme Docs')
    expect(page).toContain('at most 512 KiB')
    expect(page).toContain('at most 5 MiB')
    expect(page).toContain('more than 5 redirects')
    expect(page).toContain('at most 5 requests')
    expect(page).toContain('one every 2 seconds')
    expect(page).toContain('403')
    expect(page).toContain('robots.txt')
  })

  it('is a complete page with a language, a title and one main landmark', () => {
    const page = renderBotPage(view)
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain('<html lang="en">')
    expect(page).toContain('<title>Acme Docs link preview bot</title>')
    expect(page.match(/<main>/gu)).toHaveLength(1)
    expect(page.match(/<h1>/gu)).toHaveLength(1)
  })

  it('escapes the instance name, which an administrator typed', () => {
    const page = renderBotPage({ ...view, instanceName: '<script>alert(1)</script>' })
    expect(page).not.toContain('<script>')
    expect(page).toContain('&lt;script&gt;')
  })

  it('promises exactly what the client enforces', () => {
    expect(OPEN_WEB_LIMITS).toEqual({
      timeoutSeconds: 6,
      maxRedirects: 5,
      pageKiB: 512,
      imageMiB: 5,
    })
    expect(DEFAULT_RATE_LIMITS.perHost).toEqual({ capacity: 5, refillPerSecond: 0.5 })
  })
})
