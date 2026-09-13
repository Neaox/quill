import type { Clock, IdentityProvider } from '@quill/application'

import { createOutboundClient } from '../../infrastructure/http/outbound-client.ts'
import type { OutboundClient } from '../../infrastructure/http/outbound-client.ts'
import type { SecretResolver } from '../../infrastructure/secrets/resolve-secret.ts'
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
  /** What every provider whose issuer is `https:` reaches the network through — always the SSRF-safe client in production. */
  readonly createClient: OutboundClientFactory
  readonly clock: Clock
  /** Resolves a provider's client secret at the moment of use (ADR-034). */
  readonly secretResolver: SecretResolver
  /**
   * `OIDC_DEV_LOOPBACK`'s client (`dev-loopback-client.ts`), used **only**
   * for a provider whose issuer is `http:` — never for one that is `https:`,
   * however this flag is set. `provider-config.ts`'s `checkIssuer` already
   * refuses a plain-http issuer everywhere except under this same flag, so
   * "this provider's issuer is `http:`" and "this provider is the reason
   * `OIDC_DEV_LOOPBACK` was turned on" are one and the same test — a real
   * provider (Entra, Google, an on-prem Okta) is `https:` and is never
   * diverted, whatever else is configured on the same instance.
   */
  readonly devLoopbackClient?: OutboundClientFactory
}

/** Never a real provider's, by construction — see `devLoopbackClient`'s doc comment. */
function isInsecureIssuer(issuer: string): boolean {
  return new URL(issuer).protocol === 'http:'
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
      createClient:
        deps.devLoopbackClient !== undefined && isInsecureIssuer(config.issuer)
          ? deps.devLoopbackClient
          : deps.createClient,
      clock: deps.clock,
      secretResolver: deps.secretResolver,
    }),
  )
  const byId = new Map(providers.map((provider) => [provider.id, provider]))

  return {
    list: () => providers,
    find: (id) => byId.get(id),
  }
}
