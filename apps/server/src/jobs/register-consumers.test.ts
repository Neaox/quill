import {
  ATTACHMENT_REVISED,
  COLLECTION_DELETED,
  DOCUMENT_CREATED,
  DOCUMENT_DELETED,
  DOCUMENT_MOVED,
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
  GRANT_CREATED,
  GRANT_REVOKED,
  LINK_PREVIEW_REQUESTED,
  MAIL_REQUESTED,
  REVIEW_DECIDED,
  REVIEW_REQUESTED,
  REVIEW_WITHDRAWN,
} from '@quill/application'
import { describe, expect, it } from 'vitest'

import type { OutboxConsumer } from '../infrastructure/outbox/consumer.ts'
import { registerOutboxConsumers } from './register-consumers.ts'

/**
 * The poller claims only the event types something is registered for, and an
 * unregistered type piles up for ever (review finding H6). So the list of what
 * Quill emits and the list of what is registered must be the same list.
 */

const EMITTED = [
  ATTACHMENT_REVISED,
  COLLECTION_DELETED,
  DOCUMENT_CREATED,
  DOCUMENT_DELETED,
  DOCUMENT_MOVED,
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
  GRANT_CREATED,
  GRANT_REVOKED,
  LINK_PREVIEW_REQUESTED,
  MAIL_REQUESTED,
  REVIEW_DECIDED,
  REVIEW_REQUESTED,
  REVIEW_WITHDRAWN,
]

function registered(): readonly OutboxConsumer[] {
  const consumers: OutboxConsumer[] = []
  registerOutboxConsumers(
    {
      register: (consumer) => consumers.push(consumer),
      // The slow lane for fetching other people's pages (ADR-042) holds one consumer per type too.
      lane: (consumer) => consumers.push(consumer),
    },
    // The consumers are only constructed here, never run.
    { deps: {} as never, mailer: {} as never },
  )
  return consumers
}

describe('registerOutboxConsumers', () => {
  it('has a consumer for every event type Quill emits, so none accumulates unclaimed', () => {
    expect(
      registered()
        .map((consumer) => consumer.eventType)
        .toSorted(),
    ).toEqual(EMITTED.toSorted())
  })

  it('registers each type exactly once, because the runner holds one consumer per type', () => {
    const types = registered().map((consumer) => consumer.eventType)
    expect(new Set(types).size).toBe(types.length)
  })

  it('does nothing with the events no release acts on yet, and says why', () => {
    const quiet = registered().filter((consumer) => 'reason' in consumer)
    expect(quiet.map((consumer) => consumer.eventType).toSorted()).toEqual(
      [
        COLLECTION_DELETED,
        DOCUMENT_CREATED,
        DOCUMENT_DELETED,
        GRANT_CREATED,
        GRANT_REVOKED,
      ].toSorted(),
    )
  })
})
