import { ok } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import type { LinkConnector } from '../ports/link-connectors.ts'
import { createLinkConnectorRegistry } from './link-connectors.ts'

function connector(
  id: string,
  hosts: string[],
  matches = (url: URL) => url.pathname !== '/no',
): LinkConnector {
  return {
    id,
    hosts,
    secretName: `connectors/${id}/token`,
    matches,
    resolve: async () =>
      ok({
        canonicalUrl: 'https://example.com/',
        title: 'A title',
        description: null,
        siteName: null,
        kind: 'website',
        imageUrl: null,
      }),
  }
}

describe('the connector registry', () => {
  const github = connector('github', ['github.com', 'www.github.com'])
  const jira = connector('jira', ['acme.atlassian.net'])
  const registry = createLinkConnectorRegistry([github, jira])

  it('finds the connector for a host of its family, whatever the case', () => {
    expect(registry.find(new URL('https://github.com/o/r'))).toBe(github)
    expect(registry.find(new URL('https://WWW.GitHub.com/o/r'))).toBe(github)
    expect(registry.find(new URL('https://acme.atlassian.net/browse/A-1'))).toBe(jira)
  })

  it('finds nothing for a host no connector claims, or a shape the connector declines', () => {
    expect(registry.find(new URL('https://example.com/o/r'))).toBeNull()
    expect(registry.find(new URL('https://github.com/no'))).toBeNull()
  })

  it('does not match a look-alike host or a subdomain it did not name', () => {
    expect(registry.find(new URL('https://github.com.evil.example/o/r'))).toBeNull()
    expect(registry.find(new URL('https://gist.github.com/o/r'))).toBeNull()
  })

  it('refuses two connectors claiming one host, naming both', () => {
    expect(() => createLinkConnectorRegistry([github, connector('other', ['github.com'])])).toThrow(
      /github\.com.*github.*other/u,
    )
  })

  it('is empty without connectors', () => {
    expect(createLinkConnectorRegistry([]).find(new URL('https://github.com/o/r'))).toBeNull()
  })
})
