import type pg from 'pg'
import { createEventRecorder } from '@quill/application'
import type {
  EventBus,
  IdGenerator,
  RecordedEvent,
  RepositoryBundle,
  UnitOfWork,
} from '@quill/application'

import type { DrizzleClient } from '../db/types.ts'
import { createAttachmentRepository } from './attachment-repository.ts'
import { createAuditWriter } from './audit-writer.ts'
import { createCollectionRepository } from './collection-repository.ts'
import { createCredentialRepository } from './credential-repository.ts'
import { createDocumentRepository } from './document-repository.ts'
import { createDocumentLinksRepository } from './document-links-repository.ts'
import { createDraftRepository } from './draft-repository.ts'
import { createGrantRepository } from './grant-repository.ts'
import { createGroupRepository } from './group-repository.ts'
import { createIdentityRepository } from './identity-repository.ts'
import { createLockRepository } from './lock-repository.ts'
import { createMagicLinkRepository } from './magic-link-repository.ts'
import { createOutboxWriter } from './outbox-writer.ts'
import { createPersonPreferencesRepository } from './person-preferences-repository.ts'
import { createPublicRedirectRepository } from './public-redirect-repository.ts'
import { createRenderCacheRepository } from './render-cache-repository.ts'
import { createRevisionsIndexRepository } from './revisions-index-repository.ts'
import { createSecretRepository } from './secret-repository.ts'
import { createSessionRepository } from './session-repository.ts'
import { createShareLinkRepository } from './share-link-repository.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createUserRepository } from './user-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'
import { createWorkspaceSlugHistoryRepository } from './workspace-slug-history-repository.ts'

/**
 * Locks are always bound to the pool directly, never to a `UnitOfWork.run`
 * transaction: ADR-021 already gives `acquire`, `heartbeat`, and `release`
 * their own atomicity (see `lock-repository.ts`), and a lock is read, never
 * written, inside a transaction that publishes.
 *
 * Drafts take both: the Drizzle client, so creating a document and starting
 * its draft are one transaction, and the pool, because `write` runs its own
 * `SELECT ... FOR UPDATE` transaction and must not nest inside another.
 */
function buildBundle(
  db: DrizzleClient,
  pool: pg.Pool,
  ids: IdGenerator,
  sink: (event: RecordedEvent) => void,
): RepositoryBundle {
  return {
    users: createUserRepository(db),
    sessions: createSessionRepository(db),
    credentials: createCredentialRepository(db),
    magicLinks: createMagicLinkRepository(db),
    identities: createIdentityRepository(db),
    units: createUnitRepository(db),
    groups: createGroupRepository(db),
    workspaces: createWorkspaceRepository(db),
    workspaceSlugHistory: createWorkspaceSlugHistoryRepository(db),
    collections: createCollectionRepository(db),
    documents: createDocumentRepository(db),
    drafts: createDraftRepository(db, pool),
    locks: createLockRepository(pool),
    grants: createGrantRepository(db, ids),
    shareLinks: createShareLinkRepository(db),
    publicRedirects: createPublicRedirectRepository(db),
    revisions: createRevisionsIndexRepository(db),
    renderCache: createRenderCacheRepository(db),
    documentLinks: createDocumentLinksRepository(db),
    secrets: createSecretRepository(db),
    attachments: createAttachmentRepository(db),
    personPreferences: createPersonPreferencesRepository(db),
    events: createEventRecorder({ outbox: createOutboxWriter(db), ids, sink }),
    audit: createAuditWriter(db),
  }
}

/**
 * `ids` is required, not defaulted.
 *
 * It used to default to the system generator, which made this file a second
 * composition root inside infrastructure (review finding L5): a caller that
 * forgot to pass one silently got real UUIDs, and the test harness did
 * exactly that — so ids that every other part of the harness controlled were
 * uncontrolled here, and nothing said so. The process that wires the
 * application chooses the generator; this only uses it.
 *
 * `bus`, when there is one, is told what a transaction recorded — and only
 * once that transaction has committed, never before it and never if it rolls
 * back (ADR-052). A process with nothing to tell, a script or a benchmark,
 * passes none and the events are written to the outbox all the same.
 */
export function createUnitOfWork(
  db: DrizzleClient,
  pool: pg.Pool,
  ids: IdGenerator,
  bus?: EventBus,
): UnitOfWork {
  return {
    // Outside a transaction each write commits as it is made, so what it
    // recorded is announced at once. `publish` never rejects.
    repos: buildBundle(db, pool, ids, (event) => {
      void bus?.publish(event)
    }),
    async run(fn) {
      const pending: RecordedEvent[] = []
      const result = await db.transaction((tx) =>
        fn(buildBundle(tx, pool, ids, (event) => pending.push(event))),
      )
      // Awaited, so a request that revoked access has cleared what depended on
      // it by the time it answers; a throw above skips this, which is the rollback.
      for (const event of pending) await bus?.publish(event)
      return result
    },
  }
}
