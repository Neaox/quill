import { DOCUMENT_CREATED, DOCUMENT_PUBLISHED } from '@quill/application'
import { createSearchService } from '@quill/search'
import { createFakeClock, createFakeIdGenerator } from '@quill/application/test-support'
import type { FakeClock } from '@quill/application/test-support'
import type { UserId } from '@quill/domain'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import type { RateLimitConfig } from '../config.ts'
import type { AppDependencies } from '../dependencies.ts'
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
import { createRenderOnPublishConsumer } from '../infrastructure/outbox/render-on-publish.ts'
import { createPostgresSearchIndex } from '../infrastructure/search/postgres-search-index.ts'
import { createVisibleDocumentResolver } from '../infrastructure/search/visible-documents.ts'
import { createSendMailConsumer } from '../infrastructure/outbox/send-mail.ts'
import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createJobRunner } from '../jobs/job-runner.ts'
import type { JobRunner } from '../jobs/job-runner.ts'
import { createSweepJob } from '../jobs/sweep-expired.ts'
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
 * touching a disk.
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

export interface HarnessOptions {
  /**
   * Overrides the deliberately enormous default budget, for a test that is
   * *about* the rate limit rather than merely subject to it.
   */
  readonly rateLimit?: RateLimitConfig
  /** `SHARE_LINKS=off`, for the tests that check the policy closes the door. */
  readonly shareLinksAllowed?: boolean
}

export async function createServerHarness(options: HarnessOptions = {}): Promise<ServerHarness> {
  const database = await createTestDatabase()
  const clock = createFakeClock(HARNESS_NOW)
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
  })
  const config =
    options.rateLimit === undefined ? loaded : { ...loaded, rateLimit: options.rateLimit }
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
  const deps: AppDependencies = {
    uow,
    searchIndex,
    search: createSearchService(searchIndex),
    contentStore: createContentStore({ driver: 'memory' }, clock),
    format: createDocumentFormat(),
    clock,
    ids,
    hasher: createHasher(),
    tokens: createTokenService(),
    shareLinkPolicy: { allowed: () => shareLinksAllowed },
    mailer,
    breachedPasswords,
    rateLimiter: createRateLimiter({ clock, config: config.rateLimit }),
    passwords: await createPasswordHasher(),
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
  jobRunner.register(
    combineConsumers(
      DOCUMENT_PUBLISHED,
      createRenderOnPublishConsumer(deps),
      createIndexOnPublishConsumer(deps),
    ),
  )
  jobRunner.register(createIndexOnRenameConsumer(deps))
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
    },
  }
}
