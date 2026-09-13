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
import { createRateLimiter } from './auth/rate-limit.ts'
import { createTokenService } from './auth/tokens.ts'
import { createSmtpMailer } from './auth/smtp-mailer.ts'
import { loadConfig } from './config.ts'
import { createContentStore } from './infrastructure/content-store.ts'
import { createDatabase } from './infrastructure/db/connection.ts'
import { createHasher } from './infrastructure/hasher.ts'
import { createOutboundClient } from './infrastructure/http/outbound-client.ts'
import { runMigrations } from './infrastructure/db/migrator.ts'
import { createDocumentFormat } from './infrastructure/markdown/document-format.ts'
import { createAcknowledgingConsumer } from './infrastructure/outbox/acknowledge.ts'
import { createRenderOnPublishConsumer } from './infrastructure/outbox/render-on-publish.ts'
import { createSendMailConsumer } from './infrastructure/outbox/send-mail.ts'
import { pollOutboxOnce } from './infrastructure/outbox/poller.ts'
import { createUnitOfWork } from './infrastructure/repositories/unit-of-work.ts'
import { createSystemClock } from './infrastructure/system-clock.ts'
import { createUuidGenerator } from './infrastructure/uuid-generator.ts'
import { createJobRunner } from './jobs/job-runner.ts'
import { createShutdown } from './shutdown.ts'
import { createSweepJob } from './jobs/sweep-expired.ts'
import { DOCUMENT_CREATED, DOCUMENT_RENAMED } from '@quill/application'

const config = loadConfig()
const clock = createSystemClock()
const ids = createUuidGenerator()
const hasher = createHasher()
const tokens = createTokenService()

const database = createDatabase({ connectionString: config.databaseUrl })
await runMigrations(database.pool)

const mailer: Mailer =
  config.mailer.driver === 'smtp'
    ? createSmtpMailer(config.mailer)
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

const uow = createUnitOfWork(database.db, database.pool, ids)
const contentStore = createContentStore(config.contentStore, clock)
const format = createDocumentFormat()
const rateLimiter = createRateLimiter({ clock, config: config.rateLimit })
// One Argon2id hash at startup, so no request ever pays for the dummy.
const passwords = await createPasswordHasher()
const deps = {
  uow,
  contentStore,
  format,
  clock,
  ids,
  hasher,
  tokens,
  shareLinkPolicy: createShareLinkPolicy(config),
  mailer,
  breachedPasswords,
  rateLimiter,
  passwords,
  config,
}
const app = buildApp({ logLevel: config.logLevel, deps })

const jobRunner = createJobRunner({
  clock,
  poll: (consumers, now) => pollOutboxOnce(database.pool, consumers, { now }),
})
// Rendering on publish is what keeps the first reader from paying for a
// render. Nothing invalidates: a rename simply gives the bodies that link to
// the renamed document a new cache key (ADR-031).
jobRunner.register(createRenderOnPublishConsumer(deps))
// Delivery happens here rather than on the request path, so an address that
// has an account costs no more than one that does not (ADR-011).
jobRunner.register(createSendMailConsumer(mailer))
// Every type something emits has a consumer, even when the consumer does
// nothing yet: the poller claims only registered types, so an unregistered
// one would accumulate for ever (review finding H6).
jobRunner.register(
  createAcknowledgingConsumer(
    DOCUMENT_CREATED,
    'Nothing acts on a creation yet; the search index arrives with M4.',
  ),
)
jobRunner.register(
  createAcknowledgingConsumer(
    DOCUMENT_RENAMED,
    'Nothing acts on a rename: a body that links to the renamed document simply renders under a new cache key (ADR-031).',
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
