import { describe, expect, it } from 'vitest'

import { renderRobots, renderSitemap, renderSitemapIndex } from './sitemap.ts'

describe('the sitemap', () => {
  it('lists each address with the instant its head revision was published', () => {
    expect(
      renderSitemap([
        {
          loc: 'https://docs.example.com/s/acme-docs/guides/rate-limits',
          lastmod: new Date('2026-08-15T10:00:00.000Z'),
        },
      ]),
    ).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        '    <loc>https://docs.example.com/s/acme-docs/guides/rate-limits</loc>',
        '    <lastmod>2026-08-15T10:00:00.000Z</lastmod>',
        '  </url>',
        '</urlset>',
        '',
      ].join('\n'),
    )
  })

  it('is well formed when a site has no pages', () => {
    expect(renderSitemap([])).toContain('<urlset')
    expect(renderSitemap([])).toContain('</urlset>')
  })

  it('escapes XML rather than HTML: an ampersand in an address cannot end an element', () => {
    const xml = renderSitemap([
      { loc: 'https://docs.example.com/s/a?x=1&y=<2>', lastmod: new Date(0) },
    ])
    expect(xml).toContain('<loc>https://docs.example.com/s/a?x=1&amp;y=&lt;2&gt;</loc>')
  })
})

describe('robots.txt', () => {
  it('allows the public site and nothing else, and names a sitemap per site', () => {
    expect(
      renderRobots({ appUrl: 'https://docs.example.com', siteSlugs: ['acme-docs', 'ops'] }),
    ).toBe(
      [
        'User-agent: *',
        'Allow: /s/',
        'Allow: /api/attachments/',
        'Disallow: /api/',
        'Disallow: /share/',
        'Disallow: /w/',
        'Disallow: /admin/',
        '',
        'Sitemap: https://docs.example.com/s/acme-docs/sitemap.xml',
        'Sitemap: https://docs.example.com/s/ops/sitemap.xml',
        '',
      ].join('\n'),
    )
  })

  it('still states the rules on an instance that publishes nothing', () => {
    const robots = renderRobots({ appUrl: 'https://docs.example.com', siteSlugs: [] })
    expect(robots).toContain('Disallow: /share/')
    expect(robots).not.toContain('Sitemap:')
  })

  /**
   * The pictures on a published page are attachment URLs, because that is what
   * the Markdown sanitiser admits as an image source. They are part of the
   * page, so the narrower `Allow` comes before the `Disallow` it carves out of.
   */
  it('allows the attachments a published page is made of, inside a disallowed API', () => {
    const robots = renderRobots({ appUrl: 'https://docs.example.com', siteSlugs: [] })
    expect(robots.indexOf('Allow: /api/attachments/')).toBeLessThan(
      robots.indexOf('Disallow: /api/'),
    )
  })
})

describe('the sitemap index', () => {
  it('names one sitemap per page, and carries no lastmod of its own', () => {
    expect(
      renderSitemapIndex([
        'https://docs.example.com/s/acme-docs/sitemap/1',
        'https://docs.example.com/s/acme-docs/sitemap/2',
      ]),
    ).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <sitemap>',
        '    <loc>https://docs.example.com/s/acme-docs/sitemap/1</loc>',
        '  </sitemap>',
        '  <sitemap>',
        '    <loc>https://docs.example.com/s/acme-docs/sitemap/2</loc>',
        '  </sitemap>',
        '</sitemapindex>',
        '',
      ].join('\n'),
    )
  })
})
