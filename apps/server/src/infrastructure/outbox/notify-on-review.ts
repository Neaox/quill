import {
  REVIEW_DECIDED,
  REVIEW_REQUESTED,
  REVIEW_WITHDRAWN,
  notifyReviewDecided,
  notifyReviewRequested,
  notifyReviewWithdrawn,
  parseReviewDecided,
  parseReviewRequested,
  parseReviewWithdrawn,
} from '@quill/application'
import type { NotificationDependencies } from '@quill/application'

import type { OutboxConsumer } from './consumer.ts'

/**
 * In-app notifications from review events (ADR-052, ADR-053).
 *
 * One consumer per event type, each a thin reading of the payload: who hears
 * about it is `notifyReview…`'s to decide, in the application layer. They are
 * idempotent, as at-least-once delivery requires, because a notification row
 * is unique per request, recipient, kind and actor. An event this release
 * cannot read is left alone for one that can (ADR-033).
 */

export function createNotifyOnReviewRequestedConsumer(
  deps: NotificationDependencies,
): OutboxConsumer {
  return {
    eventType: REVIEW_REQUESTED,
    async handle(payload: unknown): Promise<void> {
      const event = parseReviewRequested(payload)
      if (event !== null) await notifyReviewRequested(deps, event)
    },
  }
}

export function createNotifyOnReviewDecidedConsumer(
  deps: NotificationDependencies,
): OutboxConsumer {
  return {
    eventType: REVIEW_DECIDED,
    async handle(payload: unknown): Promise<void> {
      const event = parseReviewDecided(payload)
      if (event !== null) await notifyReviewDecided(deps, event)
    },
  }
}

export function createNotifyOnReviewWithdrawnConsumer(
  deps: NotificationDependencies,
): OutboxConsumer {
  return {
    eventType: REVIEW_WITHDRAWN,
    async handle(payload: unknown): Promise<void> {
      const event = parseReviewWithdrawn(payload)
      if (event !== null) await notifyReviewWithdrawn(deps, event)
    },
  }
}

/** The three, for the composition root to register. */
export function createNotifyOnReviewConsumers(deps: NotificationDependencies): OutboxConsumer[] {
  return [
    createNotifyOnReviewRequestedConsumer(deps),
    createNotifyOnReviewDecidedConsumer(deps),
    createNotifyOnReviewWithdrawnConsumer(deps),
  ]
}
