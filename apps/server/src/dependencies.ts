import type {
  Clock,
  ContentStore,
  DocumentFormat,
  Hasher,
  IdGenerator,
  UnitOfWork,
} from '@quill/application'

import type { BreachedPasswordChecker } from './auth/breached-password.ts'
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
  /** The Markdown pipeline, with the syntax highlighter already bound in (ADR-030). */
  readonly format: DocumentFormat
  readonly clock: Clock
  readonly ids: IdGenerator
  /** Content addressing for the render cache (ADR-031): SHA-256 in this process. */
  readonly hasher: Hasher
  readonly mailer: Mailer
  /** The breached-password corpus (ADR-011). Fails open, and says so in the audit log. */
  readonly breachedPasswords: BreachedPasswordChecker
  /**
   * The backing-off limiter behind `@fastify/rate-limit`. Injected so a test
   * can drive it with the fake clock and inspect what it counted.
   */
  readonly rateLimiter: RateLimiter
  /**
   * Argon2id, with the dummy hash sign-in needs already computed. Built by
   * `createPasswordHasher` in the composition root, never lazily on a request.
   */
  readonly passwords: PasswordHasher
  readonly config: ServerConfig
}
