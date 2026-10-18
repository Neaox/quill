import type { LinkConnector, LinkConnectorRegistry } from '../ports/link-connectors.ts'

/**
 * The registry of connectors (ADR-042, layer 1): one connector per host family.
 *
 * Built once, at the composition root. A host claimed twice is a configuration
 * error that would make "which connector answered" depend on registration order, so
 * it fails at construction, loudly, rather than at the first link that hits it.
 */
export function createLinkConnectorRegistry(
  connectors: readonly LinkConnector[],
): LinkConnectorRegistry {
  const byHost = new Map<string, LinkConnector>()
  for (const connector of connectors) {
    for (const host of connector.hosts) {
      const owner = byHost.get(host)
      if (owner !== undefined) {
        throw new Error(
          `Host ${host} is claimed by both the ${owner.id} and ${connector.id} connectors`,
        )
      }
      byHost.set(host, connector)
    }
  }

  return {
    find(url) {
      const connector = byHost.get(url.hostname.toLowerCase())
      return connector?.matches(url) === true ? connector : null
    },
  }
}
