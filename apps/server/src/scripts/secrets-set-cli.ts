import { createShareLinkPolicy } from '../application/share-link-policy.ts'
import { createDisabledBreachedPasswordChecker } from '../auth/breached-password.ts'
import { createDevMailer } from '../auth/dev-mailer.ts'
import { createPasswordHasher } from '../auth/password.ts'
import { createRateLimiter } from '../auth/rate-limit.ts'
import { createIdentityProviderRegistry, outboundClientFactory } from '../auth/oidc/registry.ts'
import { createTokenService } from '../auth/tokens.ts'
import { loadConfig } from '../config.ts'
import { createBlobStore } from '../infrastructure/blob/create-blob-store.ts'
import { createContentStore } from '../infrastructure/content-store.ts'
import { createDatabase } from '../infrastructure/db/connection.ts'
import { runMigrations } from '../infrastructure/db/migrator.ts'
import { createDocumentFormat } from '../infrastructure/markdown/document-format.ts'
import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createPostgresSearchIndex } from '../infrastructure/search/postgres-search-index.ts'
import { createVisibleDocumentResolver } from '../infrastructure/search/visible-documents.ts'
import { createEnvelopeCipher } from '../infrastructure/secrets/envelope-cipher.ts'
import { createKeyProvider } from '../infrastructure/secrets/key-provider.ts'
import { createSecretResolver } from '../infrastructure/secrets/resolve-secret.ts'
import { createSettingsStore } from '../infrastructure/settings-store.ts'
import { createHasher } from '../infrastructure/hasher.ts'
import { createSystemClock } from '../infrastructure/system-clock.ts'
import { createUuidGenerator } from '../infrastructure/uuid-generator.ts'
import { createSearchService } from '@quill/search'
import { setSecretValue } from './secrets-set.ts'
import type { UserId } from '@quill/domain'

/**
 * `pnpm --filter @quill/server secrets:set <name>` — the composition root for
 * `secrets-set.ts`: the same wiring `main.ts` does, without an HTTP server.
 *
 * The value is read from stdin, never from `argv`:
 *
 *   printf '%s' 'the-client-secret' | pnpm --filter @quill/server secrets:set oidc/acme/client-secret
 *
 * `SECRETS_SET_ACTOR` names the instance administrator entering it, the same
 * way `SECRETS_ROTATE_ACTOR` does for a rotation; without it the audit row is
 * attributed to nobody, which is the honest record of a value entered by a
 * deployment script rather than somebody at a keyboard.
 */

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  // A single trailing newline is the shell's, not the secret's — `echo` and
  // most editors add exactly one. Anything else in the value is kept as read.
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '')
}

const name = process.argv[2]
if (name === undefined || name.length === 0) {
  process.stderr.write(
    'Usage: pnpm --filter @quill/server secrets:set <name>, with the value piped to stdin.\n',
  )
  process.exit(1)
}

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
const secrets = createEnvelopeCipher(
  await createKeyProvider(config.masterKey, { warn: () => undefined }),
)

try {
  const value = await readStdin()
  const outcome = await setSecretValue(
    {
      uow,
      searchIndex,
      search: createSearchService(searchIndex),
      contentStore,
      settings: createSettingsStore(contentStore),
      secrets,
      blobStore: createBlobStore(config.blobStore),
      format: createDocumentFormat(),
      clock,
      ids,
      hasher: createHasher(),
      tokens: createTokenService(),
      shareLinkPolicy: createShareLinkPolicy(config),
      mailer: createDevMailer(() => undefined),
      // No secret set here reaches mail, an identity provider or an
      // attachment; the ports are present only because `AppDependencies` is
      // one shape.
      breachedPasswords: createDisabledBreachedPasswordChecker(),
      rateLimiter: createRateLimiter({ clock, config: config.rateLimit }),
      oidcRateLimiter: createRateLimiter({ clock, config: config.oidcRateLimit }),
      attachmentRateLimiter: createRateLimiter({ clock, config: config.attachments.rateLimit }),
      passwords: await createPasswordHasher(),
      identityProviders: createIdentityProviderRegistry({
        providers: config.oidcProviders,
        appUrl: config.appUrl,
        createClient: outboundClientFactory,
        clock,
        secretResolver: createSecretResolver({ uow, secrets, clock, ids }),
      }),
      config,
    },
    name,
    value,
    (process.env['SECRETS_SET_ACTOR'] ?? null) as UserId,
    (line) => process.stdout.write(`${line}\n`),
  )
  if (outcome !== 'set') process.exitCode = 1
} finally {
  await database.close()
}
