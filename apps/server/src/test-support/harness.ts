import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DOCUMENT_CREATED,
  DOCUMENT_MOVED,
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
} from '@quill/application'
import { createSearchService } from '@quill/search'
import { BRAND } from '@quill/brand'
import { createFakeClock, createFakeIdGenerator } from '@quill/application/test-support'
import type { FakeClock } from '@quill/application/test-support'
import type { UserId } from '@quill/domain'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import type { RateLimitConfig } from '../config.ts'
import type { AppDependencies } from '../dependencies.ts'
import { FilesystemBlobStore } from '../infrastructure/blob/create-blob-store.ts'
import { createContentStore } from '../infrastructure/content-store.ts'
import { createTestDatabase } from '../infrastructure/db/test-database.ts'
import type { TestDatabase } from '../infrastructure/db/test-database.ts'
import { createHasher } from '../infrastructure/hasher.ts'
import { createDocumentFormat } from '../infrastructure/markdown/document-format.ts'
import { createAcknowledgingConsumer } from '../infrastructure/outbox/acknowledge.ts'
import { pollOutboxOnce } from '../infrastructure/outbox/poller.ts'
import { combineConsumers } from '../infrastructure/outbox/combine.ts'
import {
  createIndexOnPublishConsumer,
  createIndexOnRenameConsumer,
} from '../infrastructure/outbox/index-on-publish.ts'
import {
  createRecordMoveRedirectConsumer,
  createRecordRenameRedirectConsumer,
} from '../infrastructure/outbox/record-public-redirect.ts'
import { createInvalidatePublicSiteConsumers } from '../infrastructure/outbox/invalidate-public-site.ts'
import { createRenderOnPublishConsumer } from '../infrastructure/outbox/render-on-publish.ts'
import { createPostgresSearchIndex } from '../infrastructure/search/postgres-search-index.ts'
import { createVisibleDocumentResolver } from '../infrastructure/search/visible-documents.ts'
import { createSendMailConsumer } from '../infrastructure/outbox/send-mail.ts'
import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createEnvelopeCipher } from '../infrastructure/secrets/envelope-cipher.ts'
import { createKeyProvider } from '../infrastructure/secrets/key-provider.ts'
import { createSecretResolver } from '../infrastructure/secrets/resolve-secret.ts'
import { createSettingsStore } from '../infrastructure/settings-store.ts'
import { createPublicSiteCache, PUBLIC_SITE_CACHE_TTL_MS } from '../public-site/cache.ts'
import { createPublicStylesheets, loadDesignSystemCss } from '../public-site/stylesheet.ts'
import { createJobRunner } from '../jobs/job-runner.ts'
import type { JobRunner } from '../jobs/job-runner.ts'
import { createSweepJob } from '../jobs/sweep-expired.ts'
import { createIdentityProviderRegistry, outboundClientFactory } from '../auth/oidc/registry.ts'
import type { OutboundClientFactory } from '../auth/oidc/discovery.ts'
import type { OidcProviderConfig } from '../auth/oidc/provider-config.ts'
import { createPasswordHasher } from '../auth/password.ts'
import { createRateLimiter } from '../auth/rate-limit.ts'
import { generateSessionToken, hashSessionToken } from '../auth/session-token.ts'
import { createTokenService } from '../auth/tokens.ts'
import { injectAsBrowser } from './browser-client.ts'
import { createFakeBreachedPasswordChecker, createRecordingMailer } from './fakes.ts'
import type { FakeBreachedPasswordChecker, RecordingMailer } from './fakes.ts'

/**
 * A whole server against a real database, a real content store, and the real
 * Markdown pipeline — everything except the clock, the id generator, and the
 * mailer, which a test needs to control.
 *
 * The content store is the in-memory object store, which is the same Git
 * object model as the filesystem backend at about a hundredth of the cost
 * (ADR-014), so an integration test exercises the real publish path without
 * touching a disk. The blob store has no such equivalent and needs none: it
 * is the real `FilesystemBlobStore` over a temporary directory, so an
 * attachment test exercises the adapter a self-host deployment actually runs.
 */

export interface ServerHarness {
  readonly app: FastifyInstance
  readonly deps: AppDependencies
  readonly clock: FakeClock
  /** The in-memory breached-password corpus, so a test can plant a hit. */
  readonly breachedPasswords: FakeBreachedPasswordChecker
  /** Every message the outbox has actually delivered, once `drainOutbox` has run. */
  readonly mailer: RecordingMailer
  readonly database: TestDatabase
  /** Where the harness's attachments landed, so a test can look at the files. */
  readonly blobRoot: string
  readonly jobRunner: JobRunner
  /** A session cookie header for a user, ready to pass to `app.inject`. */
  cookiesFor(userId: UserId): Promise<Record<string, string>>
  /** Runs the outbox consumers once, as the job runner would on its next tick. */
  drainOutbox(): Promise<void>
  /**
   * Turns the share-link policy on and off mid-test, which is what the
   * settings store will do at runtime once it replaces `SHARE_LINKS`.
   */
  setShareLinksAllowed(allowed: boolean): void
  close(): Promise<void>
}

export const HARNESS_NOW = new Date('2026-01-01T00:00:00.000Z')

/** Thirty-two fixed bytes: a real key, and obviously a test's. */
export const HARNESS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64')

/**
 * Single sign-on is off unless a test asks for it (ADR-011). A test that does
 * supplies the provider configuration it wants and, because a fake provider
 * necessarily listens on the loopback address the SSRF client refuses, the
 * outbound factory that reaches it — see `fake-oidc-provider.ts`.
 */
export interface HarnessOptions {
  /**
   * Overrides the deliberately enormous default budget, for a test that is
   * *about* the rate limit rather than merely subject to it.
   */
  readonly rateLimit?: RateLimitConfig
  /** `SHARE_LINKS=off`, for the tests that check the policy closes the door. */
  readonly shareLinksAllowed?: boolean
  /**
   * The fake clock to run on. Supplied when something outside the server has
   * to agree with it — a fake identity provider stamping `iat` and `exp`, for
   * instance. Defaults to a fresh one at `HARNESS_NOW`.
   */
  readonly clock?: FakeClock
  /** Zero disables the public site's page cache, for a test about what is behind it. */
  readonly publicSiteCacheTtlMs?: number
  /** Shrunk by a test that wants to see a sitemap index without a thousand documents. */
  readonly publicSitemapPageSize?: number
  readonly oidcProviders?: readonly OidcProviderConfig[]
  readonly createOidcClient?: OutboundClientFactory
  /**
   * The environment `createSecretResolver` falls back to for a provider's
   * client secret or the SMTP password (`resolve-secret.ts`), never the real
   * `process.env` — a test that wants the fallback path supplies
   * `OIDC_<ID>_CLIENT_SECRET` or `SMTP_PASS` here explicitly, exactly as an
   * operator would set it, and every other test is isolated from whatever
   * happens to be in this process's own environment. Defaults to empty, so
   * the fallback is a failure unless a test asks for it.
   */
  readonly env?: NodeJS.ProcessEnv
}

export async function createServerHarness(options: HarnessOptions = {}): Promise<ServerHarness> {
  const database = await createTestDatabase()
  const blobRoot = await mkdtemp(join(tmpdir(), `${BRAND.slug}-blobs-`))
  const clock = options.clock ?? createFakeClock(HARNESS_NOW)
  const ids = createFakeIdGenerator()
  const uow = createUnitOfWork(database.db, database.pool, ids)
  // A year on both session clocks: several tests jump the fake clock months
  // ahead to exercise a review interval or a stale lock, and must not be
  // incidentally signed out while doing it. The timeouts themselves are
  // tested against their own configuration in `plugins/session.test.ts`.
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000
  const loaded = loadConfig({
    CONTENT_STORE: 'memory',
    SESSION_TTL_MS: String(ONE_YEAR_MS),
    SESSION_IDLE_TTL_MS: String(ONE_YEAR_MS),
    // Likewise the rate limiter: a test about locks or documents must not
    // trip it. The limits themselves are tested in `auth.integration.test.ts`
    // and `plugins/rate-limit.test.ts`, against their own configuration.
    AUTH_RATE_LIMIT_MAX: '1000',
    // A real key rather than the development fallback, so an integration test
    // exercises the wrapping an operator's instance does — and so the
    // fallback's warning is not printed once per suite.
    QUILL_MASTER_KEY: HARNESS_MASTER_KEY,
  })
  // Provider configuration is supplied directly rather than through the
  // environment: `loadConfig` requires an https issuer (ADR-011) and a fake
  // provider in a test serves plain http over a loopback socket. What the
  // environment loader accepts is proved by `auth/oidc/provider-config.test.ts`.
  const config = {
    ...loaded,
    ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
    ...(options.publicSitemapPageSize === undefined
      ? {}
      : { publicSitemapPageSize: options.publicSitemapPageSize }),
    oidcProviders: options.oidcProviders ?? [],
  }
  const breachedPasswords = createFakeBreachedPasswordChecker()
  const mailer = createRecordingMailer()
  let shareLinksAllowed = options.shareLinksAllowed ?? true
  // The real PostgreSQL adapter, against the test schema: an integration test
  // that searches exercises the SQL a deployment runs (ADR-010).
  const searchIndex = createPostgresSearchIndex({
    db: database.db,
    visibility: createVisibleDocumentResolver({ uow }),
    clock,
  })
  const contentStore = createContentStore({ driver: 'memory' }, clock)
  const secrets = createEnvelopeCipher(await createKeyProvider(config.masterKey))
  // A test that wants a provider's secret resolved from the store rather
  // than from `clientSecretEnvValue` calls `setSecret` against `deps` itself
  // before driving the flow; every existing test proves the environment
  // fallback simply by never doing so (ADR-034).
  const secretResolver = createSecretResolver({ uow, secrets, clock, ids }, options.env ?? {})
  const hasher = createHasher()
  // On the fake clock, so a test that is about the cache advances time and a
  // test that is not never meets a stale page: nothing here moves the clock by
  // accident (`public-site/cache.ts`).
  const publicSiteCache = createPublicSiteCache({
    clock,
    ttlMs: options.publicSiteCacheTtlMs ?? PUBLIC_SITE_CACHE_TTL_MS,
  })
  const deps: AppDependencies = {
    uow,
    searchIndex,
    search: createSearchService(searchIndex),
    // The real design-system CSS, read once per process, so a public page in a
    // test is styled by the same bytes a deployment serves (ADR-023).
    publicStylesheets: createPublicStylesheets({
      hasher,
      designSystemCss: await loadDesignSystemCss(),
    }),
    publicSiteCache,
    contentStore,
    // The real settings adapter over the real content store: an integration
    // test of a settings write exercises the publish path and its
    // compare-and-swap, not a fake of them (ADR-034).
    settings: createSettingsStore(contentStore),
    secrets,
    blobStore: new FilesystemBlobStore(blobRoot),
    format: createDocumentFormat(),
    clock,
    ids,
    hasher,
    tokens: createTokenService(),
    shareLinkPolicy: { allowed: () => shareLinksAllowed },
    mailer,
    breachedPasswords,
    rateLimiter: createRateLimiter({ clock, config: config.rateLimit }),
    oidcRateLimiter: createRateLimiter({ clock, config: config.oidcRateLimit }),
    attachmentRateLimiter: createRateLimiter({ clock, config: config.attachments.rateLimit }),
    passwords: await createPasswordHasher(),
    identityProviders: createIdentityProviderRegistry({
      providers: config.oidcProviders,
      appUrl: config.appUrl,
      createClient: options.createOidcClient ?? outboundClientFactory,
      clock,
      secretResolver,
    }),
    config,
  }

  const app = buildApp({ logLevel: 'silent', deps, serveApiDocs: false })
  injectAsBrowser(app)
  await app.ready()

  const jobRunner = createJobRunner({
    clock,
    poll: (consumers, now) => pollOutboxOnce(database.pool, consumers, { now }),
  })
  // The same consumers the composition root registers, so an integration test
  // exercises the real delivery path rather than a shortcut (ADR-011).
  const invalidate = new Map(
    createInvalidatePublicSiteConsumers(publicSiteCache).map((consumer) => [
      consumer.eventType,
      consumer,
    ]),
  )
  /* v8 ignore next 3 -- one consumer per event type, by construction. */
  const invalidationOf = (eventType: string) => {
    const consumer = invalidate.get(eventType)
    if (consumer === undefined) throw new Error(`no public-site invalidation for ${eventType}`)
    return consumer
  }

  jobRunner.register(
    combineConsumers(
      DOCUMENT_PUBLISHED,
      createRenderOnPublishConsumer(deps),
      createIndexOnPublishConsumer(deps),
      invalidationOf(DOCUMENT_PUBLISHED),
    ),
  )
  jobRunner.register(
    combineConsumers(
      DOCUMENT_RENAMED,
      createIndexOnRenameConsumer(deps),
      createRecordRenameRedirectConsumer(deps),
      invalidationOf(DOCUMENT_RENAMED),
    ),
  )
  jobRunner.register(
    combineConsumers(
      DOCUMENT_MOVED,
      createRecordMoveRedirectConsumer(deps),
      invalidationOf(DOCUMENT_MOVED),
    ),
  )
  jobRunner.register(createSendMailConsumer(mailer))
  jobRunner.register(
    createAcknowledgingConsumer(DOCUMENT_CREATED, 'Nothing acts on a creation yet.'),
  )
  jobRunner.schedule(createSweepJob({ uow, clock, session: config.session }))

  let sessions = 0
  return {
    app,
    deps,
    clock,
    breachedPasswords,
    mailer,
    database,
    blobRoot,
    jobRunner,

    async cookiesFor(userId: UserId): Promise<Record<string, string>> {
      sessions += 1
      // The cookie carries the token; the row stores only its hash, exactly
      // as `sessionService.issue` does in production (ADR-011).
      const token = generateSessionToken()
      await uow.repos.sessions.create({
        id: `session-${sessions}`,
        userId,
        tokenHash: hashSessionToken(token),
        now: clock.now(),
        expiresAt: new Date(clock.now().getTime() + config.session.ttlMs),
      })
      return { [deps.config.session.cookieName]: token }
    },

    setShareLinksAllowed(allowed: boolean): void {
      shareLinksAllowed = allowed
    },

    async drainOutbox(): Promise<void> {
      let remaining = 10
      for (;;) {
        const result = await jobRunner.pollOnce()
        remaining -= 1
        if (result.processed === 0 || remaining === 0) return
      }
    },

    async close(): Promise<void> {
      await jobRunner.stop()
      await app.close()
      await database.drop()
      await rm(blobRoot, { recursive: true, force: true })
    },
  }
}
