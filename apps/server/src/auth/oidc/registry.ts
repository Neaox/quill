import type { Clock, IdentityProvider } from '@quill/application'

import { createOutboundClient } from '../../infrastructure/http/outbound-client.ts'
import type { OutboundClient } from '../../infrastructure/http/outbound-client.ts'
import type { OutboundClientFactory } from './discovery.ts'
import { createOidcIdentityProvider } from './oidc-provider.ts'
import type { OidcProviderConfig } from './provider-config.ts'

/**
 * The configured identity providers, by id (`docs/architecture/patterns.md`,
 * Registry).
 *
 * One entry per `OIDC_PROVIDERS` id, built once at composition time so the
 * discovery and JWKS caches inside each provider survive between requests —
 * a registry rebuilt per request would fetch the provider's metadata on every
 * sign-in, which is both slow and rude.
 *
 * An instance with no providers configured has an empty registry, and the
 * routes answer accordingly: an empty list, and `404` for a sign-in that
 * names one.
 */

export interface IdentityProviderRegistry {
  /** In configuration order, which is the order the sign-in page shows them in. */
  list(): readonly IdentityProvider[]
  find(id: string): IdentityProvider | undefined
}

export interface IdentityProviderRegistryDeps {
  readonly providers: readonly OidcProviderConfig[]
  /** The public base URL, used to build each provider's redirect URI. */
  readonly appUrl: string
  readonly createClient: OutboundClientFactory
  readonly clock: Clock
}

/**
 * The factory every process uses in production: one SSRF-safe client per
 * allowlist (ADR-011). Named rather than written inline at each composition
 * root so there is exactly one spelling of "how this platform makes an
 * outbound client for a provider".
 */
export function outboundClientFactory(allowedHosts: readonly string[]): OutboundClient {
  return createOutboundClient({ allowedHosts })
}

/** Where the provider sends the browser back. Also what is registered with the provider. */
export function oidcCallbackUrl(appUrl: string, providerId: string): string {
  return `${appUrl}/api/auth/oidc/${encodeURIComponent(providerId)}/callback`
}

export function createIdentityProviderRegistry(
  deps: IdentityProviderRegistryDeps,
): IdentityProviderRegistry {
  const providers = deps.providers.map((config) =>
    createOidcIdentityProvider({
      config,
      redirectUri: oidcCallbackUrl(deps.appUrl, config.id),
      createClient: deps.createClient,
      clock: deps.clock,
    }),
  )
  const byId = new Map(providers.map((provider) => [provider.id, provider]))

  return {
    list: () => providers,
    find: (id) => byId.get(id),
  }
}
