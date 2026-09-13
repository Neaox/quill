import type {
  Clock,
  ContentStore,
  DocumentFormat,
  Hasher,
  IdGenerator,
  SearchIndex,
  ShareLinkPolicy,
  TokenService,
  SecretCipher,
  Settings,
  UnitOfWork,
} from '@quill/application'
import type { SearchService } from '@quill/search'

import type { BreachedPasswordChecker } from './auth/breached-password.ts'
import type { IdentityProviderRegistry } from './auth/oidc/registry.ts'
import type { Mailer } from './auth/mailer.ts'
import type { PasswordHasher } from './auth/password.ts'
import type { RateLimiter } from './auth/rate-limit.ts'
import type { ServerConfig } from './config.ts'

/**
 * Everything a route or a use case needs that isn't pure business logic.
 * `buildApp` registers the full route set only when this is supplied, so
 * `app.test.ts` (which builds the app with no dependencies) keeps exercising
 * exactly the health routes it always has.
 *
 * This is a composition root and holds no logic: each field is a port, and
 * `main.ts`, the export script, and the tests each choose an implementation.
 */
export interface AppDependencies {
  readonly uow: UnitOfWork
  readonly contentStore: ContentStore
  /** Organisation and workspace settings, as files in the content store (ADR-034). */
  readonly settings: Settings
  /**
   * Envelope encryption for secrets entered in the product (ADR-034), over
   * whichever `KeyProvider` the configuration chose. A port, because the
   * master key may live somewhere that never hands it over.
   */
  readonly secrets: SecretCipher
  /** The Markdown pipeline, with the syntax highlighter already bound in (ADR-030). */
  readonly format: DocumentFormat
  readonly clock: Clock
  readonly ids: IdGenerator
  /** Content addressing for the render cache (ADR-031): SHA-256 in this process. */
  readonly hasher: Hasher
  /** Capability tokens (ADR-011): share links today. Random, stored hashed, compared safely. */
  readonly tokens: TokenService
  /**
   * Whether this organisation allows share links (plan section 14).
   *
   * TODO(M3): a thin wrapper over `config.shareLinks` until the settings
   * store lands, at which point the same port reads the organisation's own
   * setting and nothing above it changes.
   */
  readonly shareLinkPolicy: ShareLinkPolicy
  /**
   * The search engine (ADR-010). Both the index and the service over it are
   * here because they serve different callers: the outbox consumers and
   * `quill reindex` write through the index, while the route reads through
   * the service, which is where parsing, snippets, and workspace-affinity
   * grouping happen. The composition root builds the second from the first,
   * so there is still one engine.
   */
  readonly searchIndex: SearchIndex
  readonly search: SearchService
  readonly mailer: Mailer
  /** The breached-password corpus (ADR-011). Fails open, and says so in the audit log. */
  readonly breachedPasswords: BreachedPasswordChecker
  /**
   * The backing-off limiter behind `@fastify/rate-limit`. Injected so a test
   * can drive it with the fake clock and inspect what it counted.
   */
  readonly rateLimiter: RateLimiter
  /**
   * The OIDC endpoints' own limiter: a large, flat, per-address budget that
   * bounds outbound traffic rather than slowing a guess down
   * (`ServerConfig.oidcRateLimit`). Separate from `rateLimiter` because a
   * shared store would apply the auth endpoints' backoff to it.
   */
  readonly oidcRateLimiter: RateLimiter
  /**
   * Argon2id, with the dummy hash sign-in needs already computed. Built by
   * `createPasswordHasher` in the composition root, never lazily on a request.
   */
  readonly passwords: PasswordHasher
  /**
   * The configured OpenID Connect providers (ADR-011), built once so their
   * discovery and JWKS caches live as long as the process. Empty on an
   * instance with no `OIDC_PROVIDERS`.
   */
  readonly identityProviders: IdentityProviderRegistry
  readonly config: ServerConfig
}
