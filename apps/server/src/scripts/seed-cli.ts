import { createShareLinkPolicy } from '../application/share-link-policy.ts'
import { createDisabledBreachedPasswordChecker } from '../auth/breached-password.ts'
import { createDevMailer } from '../auth/dev-mailer.ts'
import { createIdentityProviderRegistry, outboundClientFactory } from '../auth/oidc/registry.ts'
import { createPasswordHasher } from '../auth/password.ts'
import { createRateLimiter } from '../auth/rate-limit.ts'
import { createTokenService } from '../auth/tokens.ts'
import { loadConfig } from '../config.ts'
import { createBlobStore } from '../infrastructure/blob/create-blob-store.ts'
import { createContentStore } from '../infrastructure/content-store.ts'
import { createDatabase } from '../infrastructure/db/connection.ts'
import { runMigrations } from '../infrastructure/db/migrator.ts'
import { createDocumentFormat } from '../infrastructure/markdown/document-format.ts'
import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createEnvelopeCipher } from '../infrastructure/secrets/envelope-cipher.ts'
import { createKeyProvider } from '../infrastructure/secrets/key-provider.ts'
import { createSettingsStore } from '../infrastructure/settings-store.ts'
import { createHasher } from '../infrastructure/hasher.ts'
import { createSystemClock } from '../infrastructure/system-clock.ts'
import { createUuidGenerator } from '../infrastructure/uuid-generator.ts'
import { createPostgresSearchIndex } from '../infrastructure/search/postgres-search-index.ts'
import { createVisibleDocumentResolver } from '../infrastructure/search/visible-documents.ts'
import { seedDevelopmentData } from './seed.ts'
import { createSearchService } from '@quill/search'

/**
 * `pnpm --filter @quill/server seed` — the seed's composition root: the same
 * wiring `main.ts` does, without an HTTP server. The work itself is in
 * `seed.ts`, which is where its tests point.
 */

/**
 * The seed writes known accounts with known passwords and overwrites them on
 * every run. That is exactly what a laptop wants and exactly what a
 * production database must never meet (review finding M13), so it refuses
 * under `NODE_ENV=production` unless an operator has said, in a second
 * variable, that they meant it — the same shape as the other refusals in
 * `config.ts`.
 */
if (process.env['NODE_ENV'] === 'production' && process.env['SEED_ALLOW_PRODUCTION'] !== '1') {
  process.stderr.write(
    'Refusing to seed under NODE_ENV=production: this creates accounts with known passwords ' +
      'and overwrites them on every run. Set SEED_ALLOW_PRODUCTION=1 if that is really what ' +
      'you want.\n',
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

try {
  const result = await seedDevelopmentData({
    uow,
    searchIndex,
    search: createSearchService(searchIndex),
    contentStore,
    settings: createSettingsStore(contentStore),
    secrets: createEnvelopeCipher(await createKeyProvider(config.masterKey)),
    blobStore: createBlobStore(config.blobStore),
    format: createDocumentFormat(),
    clock,
    ids,
    hasher: createHasher(),
    tokens: createTokenService(),
    shareLinkPolicy: createShareLinkPolicy(config),
    mailer: createDevMailer((message) => process.stdout.write(`${message}\n`)),
    // Seeding runs no HTTP and asks nothing of a corpus; both ports exist
    // because `AppDependencies` is one shape, not because seeding uses them.
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
    }),
    config,
  })
  process.stdout.write(
    [
      `Seeded workspace ${result.workspaceId} (and ${result.secondWorkspaceId})`,
      `  created:   ${result.created.length === 0 ? '(nothing new)' : result.created.join(', ')}`,
      `  unchanged: ${result.unchanged.length === 0 ? '(none)' : result.unchanged.join(', ')}`,
      '',
      'Sign in as the instance administrator:',
      `  email:    ${result.adminEmail}`,
      `  password: ${result.adminPassword}`,
      '',
      'Sign in as an editor (not an instance admin):',
      `  email:    ${result.writerEmail}`,
      `  password: ${result.writerPassword}`,
      '',
    ].join('\n'),
  )
} finally {
  await database.close()
}
