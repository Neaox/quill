import { createShareLinkPolicy } from './application/share-link-policy.ts'
import { buildApp } from './app.ts'
import {
  createDisabledBreachedPasswordChecker,
  createHibpBreachedPasswordChecker,
  withLocalFallback,
} from './auth/breached-password.ts'
import type { BreachedPasswordChecker } from './auth/breached-password.ts'
import { createDevMailer } from './auth/dev-mailer.ts'
import type { Mailer } from './auth/mailer.ts'
import { createPasswordHasher } from './auth/password.ts'
import { createIdentityProviderRegistry, outboundClientFactory } from './auth/oidc/registry.ts'
import { createDevLoopbackOutboundClientFactory } from './auth/oidc/dev-loopback-client.ts'
import { providerVariablePrefix } from './auth/oidc/provider-config.ts'
import { createRateLimiter } from './auth/rate-limit.ts'
import { createTokenService } from './auth/tokens.ts'
import { createSmtpMailer } from './auth/smtp-mailer.ts'
import { loadConfig } from './config.ts'
import { createBlobStore, FilesystemBlobStore } from './infrastructure/blob/create-blob-store.ts'
import { createContentStore } from './infrastructure/content-store.ts'
import { createDatabase } from './infrastructure/db/connection.ts'
import { createHasher } from './infrastructure/hasher.ts'
import { createOutboundClient } from './infrastructure/http/outbound-client.ts'
import { runMigrations } from './infrastructure/db/migrator.ts'
import { createDocumentFormat } from './infrastructure/markdown/document-format.ts'
import { createAcknowledgingConsumer } from './infrastructure/outbox/acknowledge.ts'
import { combineConsumers } from './infrastructure/outbox/combine.ts'
import {
  createIndexOnPublishConsumer,
  createIndexOnRenameConsumer,
} from './infrastructure/outbox/index-on-publish.ts'
import { createRenderOnPublishConsumer } from './infrastructure/outbox/render-on-publish.ts'
import { createPostgresSearchIndex } from './infrastructure/search/postgres-search-index.ts'
import { createVisibleDocumentResolver } from './infrastructure/search/visible-documents.ts'
import { createSendMailConsumer } from './infrastructure/outbox/send-mail.ts'
import { pollOutboxOnce } from './infrastructure/outbox/poller.ts'
import { createUnitOfWork } from './infrastructure/repositories/unit-of-work.ts'
import { createEnvelopeCipher } from './infrastructure/secrets/envelope-cipher.ts'
import { createKeyProvider } from './infrastructure/secrets/key-provider.ts'
import { createSecretResolver } from './infrastructure/secrets/resolve-secret.ts'
import { validateSecretsConfigured } from './infrastructure/secrets/boot-validation.ts'
import type { SecretExistenceCheck } from './infrastructure/secrets/boot-validation.ts'
import { createSettingsStore } from './infrastructure/settings-store.ts'
import { createSystemClock } from './infrastructure/system-clock.ts'
import { createUuidGenerator } from './infrastructure/uuid-generator.ts'
import { createJobRunner } from './jobs/job-runner.ts'
import { createShutdown } from './shutdown.ts'
import { createSweepJob } from './jobs/sweep-expired.ts'
import { DOCUMENT_CREATED, DOCUMENT_PUBLISHED } from '@quill/application'
import { createSearchService } from '@quill/search'

/**
 * Startup warnings are collected and replayed through the app's own logger
 * once it exists, rather than going to `process.emitWarning`: a deployment
 * reads structured JSON logs and has no reason to be watching stderr for
 * Node's warning channel. Configuration is loaded before the logger exists,
 * which is the only reason they are held rather than logged as they happen.
 */
const startupWarnings: Array<{ details: object; message: string }> = []
const warnAtStartup = (details: object, message: string): void =>
  void startupWarnings.push({ details, message })

/** How long a half-written upload has to sit before it is somebody's crash rather than somebody's work. */
const STALE_UPLOAD_MS = 60 * 60 * 1000

const config = loadConfig(process.env, (message) => warnAtStartup({ source: 'config' }, message))
const clock = createSystemClock()
const ids = createUuidGenerator()
const hasher = createHasher()
const tokens = createTokenService()

const database = createDatabase({ connectionString: config.databaseUrl })
await runMigrations(database.pool)

const uow = createUnitOfWork(database.db, database.pool, ids)
const contentStore = createContentStore(config.contentStore, clock)
// Settings are files in a system workspace of that same content store, and
// secrets are envelope-encrypted rows under the instance master key (ADR-034).
const settings = createSettingsStore(contentStore)
const secrets = createEnvelopeCipher(
  await createKeyProvider(config.masterKey, { warn: warnAtStartup }),
)
// Resolves a provider's client secret or the SMTP password at the moment of
// use, from the secrets store, falling back to the environment variable this
// migration is retiring (ADR-034). Built once so every caller shares it.
const secretResolver = createSecretResolver({ uow, secrets, clock, ids })

const mailer: Mailer =
  config.mailer.driver === 'smtp'
    ? createSmtpMailer(config.mailer, secretResolver)
    : createDevMailer((message) => process.stdout.write(`${message}\n`))

// Every server-side fetch goes through the one SSRF-safe client, with the
// breached-password corpus's own host as its entire allowlist (ADR-011).
// The bundled list sits behind whichever checker is configured, so a corpus
// that cannot be reached still refuses the passwords everybody guesses first.
const breachedPasswords: BreachedPasswordChecker = withLocalFallback(
  config.breachedPasswords.enabled
    ? createHibpBreachedPasswordChecker({
        rangeApiUrl: config.breachedPasswords.rangeApiUrl,
        client: createOutboundClient({
          allowedHosts: [new URL(config.breachedPasswords.rangeApiUrl).hostname],
        }),
      })
    : createDisabledBreachedPasswordChecker(),
)

// One registry for the process, so a provider's discovery document and key
// set are fetched once rather than on every sign-in (ADR-011). Every outbound
// call it makes goes through the SSRF-safe client, on an allowlist built from
// the issuer and the endpoints its own discovery document names — except a
// provider whose issuer is plain http, which only exists at all under
// `OIDC_DEV_LOOPBACK` (`provider-config.ts`'s `checkIssuer`), and which alone
// is diverted to loopback (`registry.ts`'s `isInsecureIssuer`); a real
// provider's issuer is `https:` and is never diverted, whatever else is
// configured on the same instance (`auth/oidc/dev-loopback-client.ts`).
const identityProviders = createIdentityProviderRegistry({
  providers: config.oidcProviders,
  appUrl: config.appUrl,
  createClient: outboundClientFactory,
  ...(config.oidcDevLoopback
    ? { devLoopbackClient: createDevLoopbackOutboundClientFactory() }
    : {}),
  clock,
  secretResolver,
})
// Diverting a provider's traffic is worth saying out loud even though it is
// never a real provider's (see above): silently changing where a request
// goes is exactly the kind of thing a startup log should name.
if (config.oidcDevLoopback) {
  for (const provider of config.oidcProviders) {
    if (new URL(provider.issuer).protocol === 'http:') {
      warnAtStartup(
        { source: 'oidc-dev-loopback', provider: provider.id },
        `OIDC_DEV_LOOPBACK is diverting the "${provider.id}" provider's traffic to loopback ` +
          `because its issuer is plain http.`,
      )
    }
  }
}

// Every secret a provider or the mailer might read at the moment of use has
// to name a value *somewhere* before this instance takes traffic — checked
// without opening a single ciphertext (`describeSecret`, not `getSecret`), so
// a missing secret is a boot failure in the same shape as a misconfigured
// provider or a missing master key, not a sign-in or a mail send that fails
// on whoever happens to trigger it first.
const secretChecks: SecretExistenceCheck[] = config.oidcProviders.map((provider) => ({
  name: provider.clientSecretName,
  envVarName: `${providerVariablePrefix(provider.id)}CLIENT_SECRET`,
  description: `the "${provider.id}" OIDC provider's client secret`,
}))
if (config.mailer.driver === 'smtp' && config.mailer.user !== undefined) {
  secretChecks.push({
    name: config.mailer.passwordSecretName,
    envVarName: 'SMTP_PASS',
    description: 'the SMTP password',
  })
}
await validateSecretsConfigured({ uow, secrets, clock, ids }, secretChecks, (message) =>
  warnAtStartup({ source: 'secrets' }, message),
)
const blobStore = createBlobStore(config.blobStore)
// A server killed mid-upload leaves a half-written temporary file behind; on
// disk they would accumulate for ever. An hour is far longer than any upload
// the cap allows can take, so nothing in flight is ever swept.
if (blobStore instanceof FilesystemBlobStore) {
  const swept = await blobStore.sweepTemporary(STALE_UPLOAD_MS, clock.now())
  if (swept > 0) process.stdout.write(`Swept ${swept} abandoned upload(s) from the blob store\n`)
}
const format = createDocumentFormat()
const rateLimiter = createRateLimiter({ clock, config: config.rateLimit })
const oidcRateLimiter = createRateLimiter({ clock, config: config.oidcRateLimit })
// Its own budget, flat rather than backing off: see `config.attachments`.
const attachmentRateLimiter = createRateLimiter({ clock, config: config.attachments.rateLimit })
// One Argon2id hash at startup, so no request ever pays for the dummy.
const passwords = await createPasswordHasher()
const searchIndex = createPostgresSearchIndex({
  db: database.db,
  visibility: createVisibleDocumentResolver({ uow }),
  clock,
})
const deps = {
  uow,
  searchIndex,
  search: createSearchService(searchIndex),
  contentStore,
  settings,
  secrets,
  blobStore,
  format,
  clock,
  ids,
  hasher,
  tokens,
  shareLinkPolicy: createShareLinkPolicy(config),
  mailer,
  breachedPasswords,
  rateLimiter,
  oidcRateLimiter,
  attachmentRateLimiter,
  passwords,
  identityProviders,
  config,
}
const app = buildApp({ logLevel: config.logLevel, deps })
for (const { details, message } of startupWarnings) app.log.warn(details, message)

const jobRunner = createJobRunner({
  clock,
  poll: (consumers, now) => pollOutboxOnce(database.pool, consumers, { now }),
})
// Two things happen on a publish, in this order: the body is rendered, so
// the first reader never pays for a render (ADR-031), and the document is
// indexed, so it is findable (ADR-010). The runner holds one consumer per
// event type, so they are combined rather than one silently replacing the
// other.
jobRunner.register(
  combineConsumers(
    DOCUMENT_PUBLISHED,
    createRenderOnPublishConsumer(deps),
    createIndexOnPublishConsumer(deps),
  ),
)
// A rename writes the new title into the document itself, and the title is
// the most heavily weighted field in the index (ADR-010). Nothing else acts
// on it: a body that links to the renamed document simply renders under a new
// cache key (ADR-031).
jobRunner.register(createIndexOnRenameConsumer(deps))
// Delivery happens here rather than on the request path, so an address that
// has an account costs no more than one that does not (ADR-011).
jobRunner.register(createSendMailConsumer(mailer))
// Every type something emits has a consumer, even when the consumer does
// nothing yet: the poller claims only registered types, so an unregistered
// one would accumulate for ever (review finding H6).
jobRunner.register(
  createAcknowledgingConsumer(
    DOCUMENT_CREATED,
    'Nothing acts on a creation: a document with no published revision has nothing to index or render.',
  ),
)
jobRunner.schedule(createSweepJob({ uow, clock, session: config.session }))
jobRunner.start()

// The order matters and is pinned by `shutdown.test.ts`: the job runner
// before the app, the app before the pool.
const shutdown = createShutdown({ jobRunner, app, database })

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    shutdown()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error(error)
        process.exit(1)
      })
  })
}

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  await shutdown()
  process.exit(1)
}
