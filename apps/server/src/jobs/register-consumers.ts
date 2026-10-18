import {
  COLLECTION_DELETED,
  DOCUMENT_CREATED,
  DOCUMENT_DELETED,
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
  GRANT_CREATED,
  GRANT_REVOKED,
} from '@quill/application'

import type { Mailer } from '../auth/mailer.ts'
import type { AppDependencies } from '../dependencies.ts'
import { createAcknowledgingConsumer } from '../infrastructure/outbox/acknowledge.ts'
import { combineConsumers } from '../infrastructure/outbox/combine.ts'
import {
  createIndexOnAttachmentRevisedConsumer,
  createIndexOnPublishConsumer,
  createIndexOnRenameConsumer,
} from '../infrastructure/outbox/index-on-publish.ts'
import {
  createRecordMoveRedirectConsumer,
  createRecordRenameRedirectConsumer,
} from '../infrastructure/outbox/record-public-redirect.ts'
import { createNotifyOnReviewConsumers } from '../infrastructure/outbox/notify-on-review.ts'
import { createRenderOnPublishConsumer } from '../infrastructure/outbox/render-on-publish.ts'
import { createSendMailConsumer } from '../infrastructure/outbox/send-mail.ts'
import type { JobRunner } from './job-runner.ts'

/**
 * Every durable consumer, registered once for both the server and the test
 * harness (ADR-056). One place says what is done about each event, so an
 * integration test exercises the real delivery path rather than a copy of it
 * (ADR-011), and so the question "does every event Quill emits have a
 * consumer?" has one place to be asked.
 *
 * The runner holds one consumer per event type and claims only the types it
 * holds, so an event type nothing is registered for would accumulate for ever
 * (review finding H6): the types nothing acts on yet are acknowledged, with
 * the reason beside them.
 *
 * What is *not* here is anything that needs telling in every process. A cache
 * is the bus's to tell (`public-site/invalidation.ts`); a consumer is claimed
 * by one poller, which is the right number of processes for indexing and the
 * wrong one for that.
 */
export function registerOutboxConsumers(
  jobRunner: Pick<JobRunner, 'register'>,
  context: { readonly deps: AppDependencies; readonly mailer: Mailer },
): void {
  const { deps, mailer } = context

  // Two things happen on a publish, in this order: the body is rendered, so
  // the first reader never pays for a render (ADR-031), and the document is
  // indexed, so it is findable (ADR-010).
  jobRunner.register(
    combineConsumers(
      DOCUMENT_PUBLISHED,
      createRenderOnPublishConsumer(deps),
      createIndexOnPublishConsumer(deps),
    ),
  )
  // A rename writes the new title into the document itself, and the title is
  // the most heavily weighted field in the index (ADR-010). It changes a
  // public address, so the old one is recorded and answered with a 301
  // (ADR-035).
  jobRunner.register(
    combineConsumers(
      DOCUMENT_RENAMED,
      createIndexOnRenameConsumer(deps),
      createRecordRenameRedirectConsumer(deps),
    ),
  )
  // A move between collections changes the collection segment of a public
  // address in the same way, and may change which site the page is on at all.
  jobRunner.register(createRecordMoveRedirectConsumer(deps))
  // A re-saved diagram (ADR-043) changes the words and the picture of every
  // published body that shows it, without a publish.
  jobRunner.register(createIndexOnAttachmentRevisedConsumer(deps))
  // Delivery happens here rather than on the request path, so an address that
  // has an account costs no more than one that does not (ADR-011).
  jobRunner.register(createSendMailConsumer(mailer))
  // A review request, an answer and a withdrawal each tell the people they
  // concern, in the app, from the committed event (ADR-053).
  for (const consumer of createNotifyOnReviewConsumers(deps)) jobRunner.register(consumer)

  jobRunner.register(
    createAcknowledgingConsumer(
      DOCUMENT_CREATED,
      'Nothing acts on a creation: a document with no published revision has nothing to index or render.',
    ),
  )
  // The caches that depend on these are told by the bus. What is durable about
  // them is the effective-permission table (quill-plan.md §15), which is
  // rebuilt from them and does not exist yet.
  for (const eventType of [GRANT_CREATED, GRANT_REVOKED, DOCUMENT_DELETED, COLLECTION_DELETED]) {
    jobRunner.register(
      createAcknowledgingConsumer(
        eventType,
        'Announced to the in-process bus for caches; the effective-permission table will rebuild from it (plan §15).',
      ),
    )
  }
}
