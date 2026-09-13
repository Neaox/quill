import { createShareLinkPolicy } from '../application/share-link-policy.ts'
import { createDisabledBreachedPasswordChecker } from '../auth/breached-password.ts'
import { createDevMailer } from '../auth/dev-mailer.ts'
import { createPasswordHasher } from '../auth/password.ts'
import { createRateLimiter } from '../auth/rate-limit.ts'
import { createTokenService } from '../auth/tokens.ts'
import { loadConfig } from '../config.ts'
import { createContentStore } from '../infrastructure/content-store.ts'
import { createDatabase } from '../infrastructure/db/connection.ts'
import { runMigrations } from '../infrastructure/db/migrator.ts'
import { createDocumentFormat } from '../infrastructure/markdown/document-format.ts'
import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createPostgresSearchIndex } from '../infrastructure/search/postgres-search-index.ts'
import { createVisibleDocumentResolver } from '../infrastructure/search/visible-documents.ts'
import { createEnvelopeCipher } from '../infrastructure/secrets/envelope-cipher.ts'
import { createKeyProvider } from '../infrastructure/secrets/key-provider.ts'
import { createSettingsStore } from '../infrastructure/settings-store.ts'
import { createHasher } from '../infrastructure/hasher.ts'
import { createSystemClock } from '../infrastructure/system-clock.ts'
import { createUuidGenerator } from '../infrastructure/uuid-generator.ts'
import { createSearchService } from '@quill/search'
import { rotateSecrets } from './rotate-secrets.ts'
import type { UserId } from '@quill/domain'

/**
 * `pnpm --filter @quill/server secrets:rotate` — the rotation's composition
 * root: the same wiring `main.ts` does, without an HTTP server. The work
 * itself is in `rotate-secrets.ts`, which is where its tests point.
 *
 * `SECRETS_ROTATE_ACTOR` names the instance administrator who asked for it, so
 * the audit row has somebody in it; without it the row is attributed to nobody,
 * which is the honest record of a rotation run from a deployment script.
 */

const config = loadConfig()
const clock = createSystemClock()
const ids = createUuidGenerator()
const database = createDatabase({ connectionString: config.databaseUrl })
await runMigrations(database.pool)
const contentStore = createContentStore(config.contentStore, clock)
const uow = createUnitOfWork(database.db, database.pool, ids)
const searchIndex = createPostgresSearchIndex({
  db: database.db,
  visibility: createVisibleDocumentResolver({ uow }),
  clock,
})

const warn = (details: object, message: string): void =>
  void process.stderr.write(`${message} ${JSON.stringify(details)}\n`)

try {
  const result = await rotateSecrets(
    {
      uow,
      searchIndex,
      search: createSearchService(searchIndex),
      contentStore,
      settings: createSettingsStore(contentStore),
      secrets: createEnvelopeCipher(await createKeyProvider(config.masterKey, { warn })),
      format: createDocumentFormat(),
      clock,
      ids,
      hasher: createHasher(),
      tokens: createTokenService(),
      shareLinkPolicy: createShareLinkPolicy(config),
      mailer: createDevMailer(() => undefined),
      // A rotation sends no mail, reaches no network and limits nothing; the
      // ports are here because `AppDependencies` is one shape.
      breachedPasswords: createDisabledBreachedPasswordChecker(),
      rateLimiter: createRateLimiter({ clock, config: config.rateLimit }),
      passwords: await createPasswordHasher(),
      config,
    },
    (process.env['SECRETS_ROTATE_ACTOR'] ?? null) as UserId,
    (line) => process.stdout.write(`${line}\n`),
  )
  if (result.unreadable.length > 0) process.exitCode = 1
} finally {
  await database.close()
}
