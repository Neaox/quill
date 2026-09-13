import { describe, expect, it } from 'vitest'
import type { DocumentId } from '@quill/domain'

import { html } from '../html.ts'
import { renderPage } from './page.ts'
import type { PageView } from './page.ts'

/**
 * The shell every public page is rendered into.
 *
 * One of these is a snapshot, deliberately of the smallest page the site can
 * produce, so that a change to the markup a crawler or a screen reader reads
 * is something a reviewer has to look at rather than something that slips
 * through in a diff of a route.
 */

const BASE: PageView = {
  siteSlug: 'acme-docs',
  siteName: 'Acme',
  links: [{ label: 'Status', href: 'https://status.example.com' }],
  navigation: [
    { documentId: 'd1' as DocumentId, title: 'Overview', path: 'guides/overview', children: [] },
  ],
  currentPath: 'guides/overview',
  title: 'Overview',
  description: 'What this is.',
  canonical: 'https://docs.example.com/s/acme-docs/guides/overview',
  stylesheetHref: '/s/_assets/theme-0123456789abcdef0123456789abcdef.css',
  robots: null,
  outline: [{ id: 'user-content-why', depth: 2, text: 'Why', children: [] }],
  main: html`<article class="layout-grid prose"><h1>Overview</h1></article>`,
  updatedAt: new Date('2026-08-15T10:00:00.000Z'),
  structuredData: null,
  query: null,
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

  it('carries no script unless there is structured data, and that one is a data block', () => {
    expect(page()).not.toContain('<script')
    const rendered = page({ structuredData: '{"@type":"Article"}' })
    expect(rendered).toContain('<script type="application/ld+json">')
    expect(rendered).toContain('{"@type":"Article"}')
    // No nonce anywhere: a nonce is minted per response, so a page carrying one
    // would have a different identity on every request and never revalidate.
    expect(rendered).not.toContain('nonce=')
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

  /**
   * `JSON.stringify` will happily produce `</script>` inside a string value,
   * which ends the element early and puts the rest of the JSON on the page as
   * markup. Escaping the `<` is enough: nothing can close the element, and the
   * value is identical to every JSON parser.
   */
  it('escapes a closing tag inside structured data', () => {
    const rendered = page({ structuredData: JSON.stringify({ headline: '</script><img src=x>' }) })
    expect(rendered).not.toContain('</script><img')
    expect(rendered).toContain('\\u003c/script>\\u003cimg src=x>')
  })

  it('escapes an ampersand inside structured data, so nothing decodes back into markup', () => {
    expect(page({ structuredData: JSON.stringify({ headline: 'a & b' }) })).toContain('a \\u0026 b')
  })

  it('carries the tenant’s top links, and omits the list when there are none', () => {
    expect(page()).toContain('<a href="https://status.example.com">Status</a>')
    expect(page({ links: [] })).not.toContain('site-links')
  })

  it('puts the query back in the box, escaped', () => {
    expect(page({ query: '"><script>' })).toContain('value="&quot;&gt;&lt;script&gt;"')
  })

  it('drops the contents when the page has no headings', () => {
    expect(page({ outline: [] })).not.toContain('site-toc')
  })
})
