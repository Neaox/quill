import { describe, expect, it } from 'vitest'
import type { PublicNavigationNode } from '@quill/application'
import type { DocumentId } from '@quill/domain'

import { renderNavigation } from './navigation.ts'

const node = (
  title: string,
  path: string,
  children: readonly PublicNavigationNode[] = [],
): PublicNavigationNode => ({ documentId: path as DocumentId, title, path, children })

const tree = [
  node('Authentication', 'guides/authentication', [
    node('Token exchange', 'guides/token-exchange'),
  ]),
  node('Overview', 'guides/overview'),
]

describe('the site navigation', () => {
  it('is a labelled landmark of nested lists', () => {
    const html = renderNavigation({ siteSlug: 'acme-docs', nodes: tree, currentPath: null }).value
    expect(html).toContain('<nav class="site-nav" aria-labelledby="site-nav-heading">')
    expect(html).toContain('id="site-nav-heading"')
    expect(html).toContain('href="/s/acme-docs/guides/token-exchange"')
    // The child is inside its parent's item, not beside it.
    expect(html.indexOf('Token exchange')).toBeGreaterThan(html.indexOf('Authentication'))
    expect(html).toContain('<li>')
  })

  it('marks the page being read, rather than colouring it alone', () => {
    const html = renderNavigation({
      siteSlug: 'acme-docs',
      nodes: tree,
      currentPath: 'guides/overview',
    }).value
    expect(html).toMatch(/href="\/s\/acme-docs\/guides\/overview"\s+aria-current="page"/u)
    expect(html.match(/aria-current/gu)).toHaveLength(1)
  })

  it('renders nothing at all for a site with no pages', () => {
    expect(renderNavigation({ siteSlug: 'acme-docs', nodes: [], currentPath: null }).value).toBe('')
  })

  it('escapes a title, which an author typed', () => {
    const html = renderNavigation({
      siteSlug: 'acme-docs',
      nodes: [node('<script>', 'guides/x')],
      currentPath: null,
    }).value
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
