import { describe, expect, it } from 'vitest'
import type { DocumentId } from '@quill/domain'

import { html } from '../html.ts'
import { navigationSection } from './navigation.ts'
import { lockupMark, renderPage } from './page.ts'
import type { PageView } from './page.ts'

/**
 * The shell every public page is rendered into, and the reader preview too.
 *
 * One of these is a snapshot, deliberately of the smallest page the site can
 * produce, so that a change to the markup a crawler or a screen reader reads
 * is something a reviewer has to look at rather than something that slips
 * through in a diff of a route.
 */

const BASE: PageView = {
  siteName: 'Acme',
  homeHref: '/s/acme-docs',
  menu: [
    {
      kind: 'link',
      link: {
        label: 'Status',
        href: 'https://status.example.com',
        external: true,
        referrer: 'hidden',
      },
    },
  ],
  currentHref: '/s/acme-docs/guides/overview',
  audience: 'public',
  searchHref: '/s/acme-docs/search',
  sections: [
    navigationSection({
      name: 'Guides',
      nodes: [
        {
          documentId: 'd1' as DocumentId,
          title: 'Overview',
          path: 'guides/overview',
          children: [],
        },
      ],
      hrefOf: (node) => `/s/acme-docs/${node.path}`,
      currentDocumentId: 'd1' as DocumentId,
      open: true,
    }),
  ],
  title: 'Overview',
  description: 'What this is.',
  canonical: 'https://docs.example.com/s/acme-docs/guides/overview',
  stylesheetHref: '/s/_assets/theme-0123456789abcdef0123456789abcdef.css',
  scriptHref: '/s/_assets/scheme-0123456789abcdef0123456789abcdef.js',
  readerHref: '/s/_assets/reader-0123456789abcdef0123456789abcdef.js',
  themeId: 'press',
  htmlAttributes: { 'data-rules': 'plain', 'data-align': 'start' },
  robots: null,
  outline: [
    { id: 'user-content-why', depth: 2, text: 'Why', children: [] },
    { id: 'user-content-how', depth: 2, text: 'How', children: [] },
    { id: 'user-content-what', depth: 2, text: 'What', children: [] },
  ],
  main: html`<article class="layout-grid prose"><h1>Overview</h1></article>`,
  updatedAt: new Date('2026-08-15T10:00:00.000Z'),
  structuredData: null,
  query: null,
  preview: null,
}

const page = (overrides: Partial<PageView> = {}): string => renderPage({ ...BASE, ...overrides })

describe('the public page', () => {
  it('renders the whole page, and this is what it looks like', () => {
    expect(page()).toMatchSnapshot()
  })

  it('carries the landmarks and the skip link', () => {
    const rendered = page()
    expect(rendered).toContain('<a class="skip-link" href="#site-main">')
    expect(rendered).toContain('<header class="site-header">')
    expect(rendered).toContain('<main class="site-main" id="site-main">')
    expect(rendered).toContain('<footer class="site-footer">')
    expect(rendered).toContain('role="search"')
    expect(rendered).toContain('aria-labelledby="site-nav-heading"')
    expect(rendered).toContain('aria-labelledby="site-toc-heading"')
  })

  it('names the theme identity its stylesheet applies under on the document element', () => {
    expect(page()).toContain(
      '<html lang="en" data-theme-id="press" data-rules="plain" data-align="start">',
    )
  })

  it('writes no attribute whose name is not data- and a word, and escapes every value', () => {
    const rendered = page({
      htmlAttributes: { onload: 'x()', 'data-rules': '"><script>' },
    })
    expect(rendered).not.toContain('onload')
    expect(rendered).not.toContain('"><script>')
  })

  it('never carries a noindex, on any page', () => {
    expect(page()).not.toContain('noindex')
    expect(page({ canonical: null, description: null })).not.toContain('noindex')
  })

  it('appends the site name to a document title, and does not repeat it on the home', () => {
    expect(page({ title: 'Overview' })).toContain('<title>Overview · Acme</title>')
    expect(page({ title: 'Acme' })).toContain('<title>Acme</title>')
  })

  it('carries the canonical link, the description and the Open Graph tags', () => {
    const rendered = page()
    expect(rendered).toContain(
      '<link rel="canonical" href="https://docs.example.com/s/acme-docs/guides/overview" />',
    )
    expect(rendered).toContain('<meta name="description" content="What this is." />')
    expect(rendered).toContain('<meta property="og:title" content="Overview" />')
    expect(rendered).toContain('<meta property="og:description" content="What this is." />')
    expect(rendered).toContain(
      '<meta property="og:url" content="https://docs.example.com/s/acme-docs/guides/overview" />',
    )
    expect(rendered).toContain('<meta property="og:site_name" content="Acme" />')
  })

  it('omits the canonical and the description rather than inventing either', () => {
    const rendered = page({ canonical: null, description: null })
    expect(rendered).not.toContain('rel="canonical"')
    expect(rendered).not.toContain('og:url')
    expect(rendered).not.toContain('name="description"')
    expect(rendered).not.toContain('og:description')
  })

  it('preloads the one stylesheet it loads', () => {
    const rendered = page()
    expect(rendered).toContain(
      '<link rel="preload" as="style" href="/s/_assets/theme-0123456789abcdef0123456789abcdef.css" />',
    )
    expect(rendered).toContain(
      '<link rel="stylesheet" href="/s/_assets/theme-0123456789abcdef0123456789abcdef.css" />',
    )
  })

  /**
   * The scheme script is a same-origin file, admitted by `script-src 'self'`,
   * and loaded in the head so it runs before first paint. Nothing inline runs:
   * the only inline `<script>` is structured data, a data block a browser
   * never executes, and there is no nonce anywhere, so the page's bytes are
   * its whole identity and a `304` stays correct (`scheme-script.ts`).
   */
  it('runs no inline script, and no nonce varies the page', () => {
    const rendered = page()
    expect(rendered).toContain(
      '<script src="/s/_assets/scheme-0123456789abcdef0123456789abcdef.js"></script>',
    )
    expect(rendered.indexOf('scheme-0123')).toBeLessThan(rendered.indexOf('</head>'))
    expect(rendered).toContain(
      '<script type="module" src="/s/_assets/reader-0123456789abcdef0123456789abcdef.js"></script>',
    )
    // Every script is a same-origin file, addressed by its hash: none inline.
    const scripts = rendered.match(/<script[^>]*>/gu) ?? []
    expect(scripts).toHaveLength(2)
    for (const script of scripts) expect(script).toMatch(/ src="\/s\/_assets\//u)
    const withData = page({ structuredData: '{"@type":"Article"}' })
    expect(withData).toContain('<script type="application/ld+json">')
    expect(withData).toContain('{"@type":"Article"}')
    expect(withData).not.toContain('nonce=')
  })

  it('offers System, Light and Dark, hidden until the script can make them work', () => {
    const rendered = page()
    expect(rendered).toMatch(/<fieldset class="site-scheme" hidden>/u)
    expect(rendered).toContain('<legend class="visually-hidden">Colour scheme</legend>')
    for (const value of ['system', 'light', 'dark']) {
      expect(rendered).toContain(`name="site-scheme" value="${value}"`)
    }
  })

  it('says noindex only where the page is not a published document', () => {
    expect(page()).not.toContain('name="robots"')
    expect(page({ robots: 'noindex,follow' })).toContain(
      '<meta name="robots" content="noindex,follow" />',
    )
  })

  it('puts the footer outside main, where a footer is a landmark', () => {
    const rendered = page()
    expect(rendered.indexOf('site-footer')).toBeGreaterThan(rendered.indexOf('</main>'))
  })

  it('escapes a closing tag inside structured data', () => {
    const rendered = page({ structuredData: JSON.stringify({ headline: '</script><img src=x>' }) })
    expect(rendered).not.toContain('</script><img')
    expect(rendered).toContain('\\u003c/script>\\u003cimg src=x>')
  })

  it('escapes an ampersand inside structured data, so nothing decodes back into markup', () => {
    expect(page({ structuredData: JSON.stringify({ headline: 'a & b' }) })).toContain('a \\u0026 b')
  })

  it('carries the organisation’s menu in the header, and omits it when there is none', () => {
    const header = /<header[\s\S]*<\/header>/u.exec(page())?.[0] ?? ''
    expect(header).toContain('<nav class="site-bar" aria-label="Site">')
    expect(header).toMatch(/href="https:\/\/status\.example\.com"\s+rel="noopener noreferrer"/u)
    expect(page({ menu: [] })).not.toContain('site-bar')
    expect(page({ menu: [] })).not.toContain('site-compact')
  })

  it('puts the query back in the box, escaped', () => {
    expect(page({ query: '"><script>' })).toContain('value="&quot;&gt;&lt;script&gt;"')
  })

  it('has no search box where there is nothing to search', () => {
    expect(page({ searchHref: null })).not.toContain('role="search"')
  })

  it('drops the contents when the page has too few headings', () => {
    expect(page({ outline: [] })).not.toContain('site-toc')
  })

  it('folds the documents into a disclosure a narrow screen can open', () => {
    const rendered = page()
    expect(rendered).toMatch(/<details class="site-menu" open>\s*<summary>Documents<\/summary>/u)
    expect(page({ sections: [] })).not.toContain('site-menu')
  })

  it('sets the organisation’s lockup: a mark, its name and a quieter edition', () => {
    const rendered = page()
    expect(rendered).toContain('<a class="site-brand" href="/s/acme-docs">')
    expect(rendered).toMatch(/<span class="site-mark" aria-hidden="true">A<\/span/u)
    expect(rendered).toMatch(/Acme\s*<span class="site-edition">docs<\/span>/u)
    expect(page({ homeHref: null })).toContain('<span class="site-brand">')
  })

  it('carries the preview banner only when it is given one', () => {
    expect(page()).not.toContain('site-preview')
    expect(page({ preview: html`<aside class="site-preview"></aside>` })).toContain('site-preview')
  })
})

describe('the lockup mark', () => {
  it('is the first letter of the name, as a reader would write it', () => {
    expect(lockupMark('acme')).toBe('A')
    expect(lockupMark('  ünder')).toBe('Ü')
    expect(lockupMark('👩‍💻 Devs')).toBe('👩‍💻')
    expect(lockupMark('')).toBe('')
  })
})
