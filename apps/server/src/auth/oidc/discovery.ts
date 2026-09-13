import type { Clock } from '@quill/application'

import type { OutboundClient } from '../../infrastructure/http/outbound-client.ts'
import type { Jwks } from './id-token.ts'

/**
 * The provider's own description of itself, fetched once and kept for a
 * while (ADR-011: discovery, with JWKS "caching and key rotation").
 *
 * Both documents come through the SSRF-safe outbound client, never `fetch`:
 * an issuer is configuration an administrator typed, which makes it exactly
 * the kind of URL that must not be allowed to reach the metadata service or
 * the database port.
 *
 * The endpoints a discovery document names are trusted to the extent that
 * they are the issuer's to declare — Amazon Cognito really does host its
 * token endpoint on a different name from its issuer — but only under the
 * issuer's own scheme. An https issuer whose document names an http token
 * endpoint is a downgrade, and is refused here rather than at the socket.
 */

export interface DiscoveryDocument {
  readonly issuer: string
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly jwksUri: string
  /** What the token endpoint accepts; empty when the provider does not say. */
  readonly tokenEndpointAuthMethods: readonly string[]
  /** The hosts this provider's endpoints live on: the outbound allowlist for the rest of the flow. */
  readonly hosts: readonly string[]
}

export interface ProviderMetadata {
  readonly discovery: DiscoveryDocument
  readonly jwks: Jwks
}

export type MetadataResult =
  | { readonly ok: true; readonly metadata: ProviderMetadata }
  | { readonly ok: false; readonly detail: string }

export interface MetadataCache {
  /** The cached metadata, fetching it when there is none or it has aged out. */
  get(): Promise<MetadataResult>
  /**
   * Re-reads the key set because a token named a `kid` nothing published:
   * the provider has rotated. Rate-limited internally, so a stream of tokens
   * carrying invented key ids cannot turn a sign-in page into a load
   * generator pointed at the provider.
   */
  refreshKeys(): Promise<MetadataResult>
}

export interface MetadataCacheDeps {
  readonly issuer: string
  /** Built per host set, because the token endpoint may not share the issuer's host. */
  readonly createClient: OutboundClientFactory
  readonly clock: Clock
  /** How long a fetched document is reused. */
  readonly ttlMs: number
  /** The floor between two key-rotation refreshes. */
  readonly minRefreshIntervalMs: number
}

export interface OutboundClientFactory {
  (allowedHosts: readonly string[]): OutboundClient
}

export const DEFAULT_METADATA_TTL_MS = 60 * 60 * 1000
export const DEFAULT_MIN_KEY_REFRESH_INTERVAL_MS = 60 * 1000

/** The discovery URL for an issuer, with the trailing slash Auth0 publishes handled. */
export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
}

function readString(document: Record<string, unknown>, name: string): string | null {
  const value = document[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** An endpoint the issuer may name: absolute, and no weaker than the issuer's own scheme. */
function endpointHost(
  raw: string,
  issuerScheme: string,
  name: string,
): { readonly ok: true; readonly host: string } | { readonly ok: false; readonly detail: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, detail: `${name} is not an absolute URL` }
  }
  if (url.protocol !== issuerScheme) {
    return { ok: false, detail: `${name} does not use the issuer's own scheme` }
  }
  return { ok: true, host: url.hostname }
}

function parseDiscovery(issuer: string, body: string): DiscoveryDocument | string {
  const document = parseJson(body)
  if (document === null) return 'the discovery document is not a JSON object'

  // The specification requires this equality, and it is what stops a
  // redirect or a shared host answering for somebody else's issuer.
  if (readString(document, 'issuer') !== issuer) {
    return 'the discovery document declares a different issuer'
  }
  const authorizationEndpoint = readString(document, 'authorization_endpoint')
  const tokenEndpoint = readString(document, 'token_endpoint')
  const jwksUri = readString(document, 'jwks_uri')
  if (authorizationEndpoint === null || tokenEndpoint === null || jwksUri === null) {
    return 'the discovery document is missing an endpoint'
  }

  const issuerScheme = new URL(issuer).protocol
  const hosts: string[] = [new URL(issuer).hostname]
  for (const [name, endpoint] of [
    ['authorization_endpoint', authorizationEndpoint],
    ['token_endpoint', tokenEndpoint],
    ['jwks_uri', jwksUri],
  ] as const) {
    const host = endpointHost(endpoint, issuerScheme, name)
    if (!host.ok) return host.detail
    if (!hosts.includes(host.host)) hosts.push(host.host)
  }

  const methods = document['token_endpoint_auth_methods_supported']
  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    tokenEndpointAuthMethods: Array.isArray(methods)
      ? methods.filter((entry) => typeof entry === 'string')
      : [],
    hosts,
  }
}

function parseJwks(body: string): Jwks | string {
  const document = parseJson(body)
  if (document === null) return 'the key set is not a JSON object'
  const keys = document['keys']
  if (!Array.isArray(keys) || keys.length === 0) {
    return 'the key set has no keys'
  }
  if (!keys.every((key) => typeof key === 'object' && key !== null && !Array.isArray(key))) {
    return 'the key set holds something that is not a key'
  }
  return { keys: keys as Jwks['keys'] }
}

export function createMetadataCache(deps: MetadataCacheDeps): MetadataCache {
  const { issuer, createClient, clock, ttlMs, minRefreshIntervalMs } = deps
  const issuerHost = new URL(issuer).hostname

  let cached: ProviderMetadata | undefined
  let fetchedAt = 0
  let keysRefreshedAt = 0
  /** One in-flight fetch at a time: a cold cache and ten sign-ins is one round trip, not ten. */
  let inFlight: Promise<MetadataResult> | undefined

  async function readBody(
    client: OutboundClient,
    url: string,
    what: string,
  ): Promise<string | { readonly detail: string }> {
    try {
      const response = await client.get({ url, headers: { accept: 'application/json' } })
      if (response.status !== 200) {
        return { detail: `${what} answered ${String(response.status)}` }
      }
      return response.body
    } catch (error) {
      return { detail: `${what} could not be read: ${describe(error)}` }
    }
  }

  async function fetchAll(): Promise<MetadataResult> {
    const body = await readBody(createClient([issuerHost]), discoveryUrl(issuer), 'discovery')
    if (typeof body !== 'string') return { ok: false, detail: body.detail }

    const discovery = parseDiscovery(issuer, body)
    if (typeof discovery === 'string') return { ok: false, detail: discovery }

    const keys = await fetchKeys(discovery)
    if (!keys.ok) return keys
    const metadata: ProviderMetadata = { discovery, jwks: keys.jwks }
    cached = metadata
    fetchedAt = clock.now().getTime()
    keysRefreshedAt = fetchedAt
    return { ok: true, metadata }
  }

  async function fetchKeys(
    discovery: DiscoveryDocument,
  ): Promise<
    { readonly ok: true; readonly jwks: Jwks } | { readonly ok: false; readonly detail: string }
  > {
    const body = await readBody(createClient(discovery.hosts), discovery.jwksUri, 'the key set')
    if (typeof body !== 'string') return { ok: false, detail: body.detail }
    const jwks = parseJwks(body)
    if (typeof jwks === 'string') return { ok: false, detail: jwks }
    return { ok: true, jwks }
  }

  function fresh(): ProviderMetadata | undefined {
    if (cached === undefined) return undefined
    return clock.now().getTime() - fetchedAt < ttlMs ? cached : undefined
  }

  async function load(): Promise<MetadataResult> {
    inFlight ??= fetchAll().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }

  return {
    async get(): Promise<MetadataResult> {
      const current = fresh()
      if (current !== undefined) return { ok: true, metadata: current }
      return load()
    },

    async refreshKeys(): Promise<MetadataResult> {
      const current = cached
      if (current === undefined) return load()

      const now = clock.now().getTime()
      if (now - keysRefreshedAt < minRefreshIntervalMs) {
        // Too soon: answer with what is already held rather than letting a
        // stream of invented key ids become outbound traffic.
        return { ok: true, metadata: current }
      }
      // Stamped before the fetch, not after it, so the floor counts attempts
      // rather than successes. Stamping on success only would mean a provider
      // whose key set is failing gets asked again on every single token that
      // names an unknown key — which is exactly when it can least afford it,
      // and exactly what an attacker sending invented key ids would want.
      keysRefreshedAt = now
      const keys = await fetchKeys(current.discovery)
      if (!keys.ok) return keys
      const metadata: ProviderMetadata = { discovery: current.discovery, jwks: keys.jwks }
      cached = metadata
      return { ok: true, metadata }
    },
  }
}

/** The message of a thrown value, without letting a stack into an audit row. */
export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
