import { describe, expect, it } from 'vitest'
import type { PublicNavigationNode } from '@quill/application'
import type { DocumentId } from '@quill/domain'

import { navigationSection, renderNavigation } from './navigation.ts'
import type { NavigationSection } from './navigation.ts'

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

const guides = (current: string | null = null): NavigationSection =>
  navigationSection({
    name: 'Guides',
    nodes: tree,
    hrefOf: (entry) => `/s/acme-docs/${entry.path}`,
    currentDocumentId: current as DocumentId | null,
    open: true,
  })

const runbooks = navigationSection({
  name: 'Runbooks',
  nodes: [node('On call', 'runbooks/on-call')],
  hrefOf: (entry) => `/s/acme-docs/${entry.path}`,
  currentDocumentId: null,
  open: false,
})

describe('the site navigation', () => {
  it('is a labelled landmark with one disclosure per collection', () => {
    const html = renderNavigation([guides(), runbooks]).value
    expect(html).toContain('<nav class="site-nav" aria-labelledby="site-nav-heading">')
    expect(html).toContain('id="site-nav-heading"')
    expect(html.match(/<details/gu)).toHaveLength(2)
    expect(html).toContain('href="/s/acme-docs/guides/token-exchange"')
  })

  it('names each collection with its document count, nested ones included', () => {
    const html = renderNavigation([guides()]).value
    expect(html).toMatch(/<summary>\s*Guides\s*<span class="site-nav-count">3<\/span>/u)
  })

  it('opens the collection being read, and only that one', () => {
    const html = renderNavigation([guides(), runbooks]).value
    expect(html.match(/<details[^>]*\bopen\b/gu)).toHaveLength(1)
    expect(html.indexOf(' open')).toBeLessThan(html.indexOf('Runbooks'))
  })

  it('nests a child inside its parent’s item, not beside it', () => {
    const html = renderNavigation([guides()]).value
    const parent = html.indexOf('Authentication')
    expect(html.indexOf('<ul', parent)).toBeLessThan(html.indexOf('Token exchange'))
  })

  it('marks the page being read, rather than colouring it alone', () => {
    const html = renderNavigation([guides('guides/overview')]).value
    expect(html).toMatch(/href="\/s\/acme-docs\/guides\/overview"\s+aria-current="page"/u)
    expect(html.match(/aria-current/gu)).toHaveLength(1)
  })

  it('renders nothing at all when there is nothing to list', () => {
    expect(renderNavigation([]).value).toBe('')
    expect(
      renderNavigation([
        navigationSection({
          name: 'Empty',
          nodes: [],
          hrefOf: () => '/',
          currentDocumentId: null,
          open: true,
        }),
      ]).value,
    ).toBe('')
  })

  it('escapes a title and a collection name, which people typed', () => {
    const html = renderNavigation([
      navigationSection({
        name: '<b>',
        nodes: [node('<script>', 'guides/x')],
        hrefOf: () => '/x',
        currentDocumentId: null,
        open: true,
      }),
    ]).value
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;')
  })
})
