import type { LinkPreview, Result } from '@quill/domain'

/**
 * Connectors: layer 1 of the link preview resolution (ADR-042).
 *
 * A connector knows one family of hosts (GitHub, later Jira or Linear) well
 * enough to ask its API about a link, instead of reading the page. That is what
 * lets a pull request be shown as "Merged" and a permalink as the lines it points
 * at. It also holds credentials, which is why a connector never uses the open-web
 * client (ADR-011): an adapter reaches its API through the allowlisted outbound
 * client, whose host list a person pasting a link cannot influence.
 *
 * Pattern: ports and adapters, with a registry of strategies. The resolver asks
 * the registry for the connector whose family the link belongs to; the connector
 * owns its URL shapes, its API, and what its answers mean.
 */

/** A secret a connector acts with. Opaque to everything but the connector; never logged, stored or returned. */
export interface ConnectorCredentials {
  readonly token: string
}

/**
 * What a connector found, before Quill has fetched pictures: a preview less the
 * fields only the resolver can fill (the stored images, the layer, the time).
 * `imageUrl` is an address for the resolver to fetch through its own, policy-checked
 * image pipeline; a connector never fetches a picture itself.
 */
export type ConnectorDraft = Omit<
  LinkPreview,
  'url' | 'thumbnail' | 'favicon' | 'layer' | 'fetchedAt'
> & {
  readonly imageUrl: string | null
}

/**
 * Why a connector made no preview. The resolver treats them differently:
 *
 * - `not_found`: the thing does not exist, or these credentials cannot see it. The
 *   page layers are tried next, as for any host.
 * - `unavailable`: the API failed or timed out. The page layers are tried next.
 * - `restricted`: it exists and it is **not public**. No preview is made, and the
 *   page layers are not tried either (a sign-in page is not a preview). See the
 *   rule on private content in ADR-042.
 * - `rate_limited`: the API said wait. Not a verdict on the link, so the fetch is
 *   deferred for `retryAfterMs` and is never counted as a failure.
 */
export type ConnectorFailure =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'restricted' }
  | { readonly kind: 'rate_limited'; readonly retryAfterMs: number }

export interface LinkConnector {
  /** Stable name, for logs and for the transparency page. */
  readonly id: string
  /**
   * The hosts of the family, exact and lower case. A host belongs to at most one
   * connector, so two can never both claim a link.
   */
  readonly hosts: readonly string[]
  /**
   * The name of the secret holding the connector's credentials in the secrets store
   * (ADR-034). A connector may also work without credentials, for public things.
   */
  readonly secretName: string
  /** Whether this is a URL shape the connector can preview. Pure; makes no request. */
  matches(url: URL): boolean
  /**
   * Asks the API. Never throws for an expected outcome. `credentials` is null when
   * none are configured. `signal` bounds the whole call, every request it makes.
   */
  resolve(
    url: URL,
    credentials: ConnectorCredentials | null,
    signal: AbortSignal,
  ): Promise<Result<ConnectorDraft, ConnectorFailure>>
}

export interface LinkConnectorRegistry {
  /** The connector that previews this link, or null when none does. */
  find(url: URL): LinkConnector | null
}

/** Reads a connector's credentials at the moment of use; never held, so a rotation takes effect at once. */
export interface ConnectorCredentialSource {
  forConnector(connector: LinkConnector): Promise<ConnectorCredentials | null>
}
