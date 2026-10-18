import {
  EVENT_PAYLOAD_VERSION,
  REVIEW_DECIDED,
  REVIEW_REQUESTED,
  REVIEW_WITHDRAWN,
} from '@quill/application'
import type { NotificationDependencies } from '@quill/application'
import { describe, expect, it, vi } from 'vitest'

import { createNotifyOnReviewConsumers } from './notify-on-review.ts'

/**
 * What the consumers do with a payload, without a database behind them: the
 * fan-out itself is the application layer's and the whole path is exercised in
 * `routes/notifications.integration.test.ts`.
 */

function dependencies() {
  const run = vi.fn<() => Promise<number>>(async () => 0)
  return { deps: { uow: { run } } as unknown as NotificationDependencies, run }
}

describe('the review notification consumers', () => {
  it('registers one consumer per review event type', () => {
    const consumers = createNotifyOnReviewConsumers(dependencies().deps)
    expect(consumers.map((consumer) => consumer.eventType)).toEqual([
      REVIEW_REQUESTED,
      REVIEW_DECIDED,
      REVIEW_WITHDRAWN,
    ])
  })

  it('leaves a payload this release cannot read alone', async () => {
    const { deps, run } = dependencies()
    for (const consumer of createNotifyOnReviewConsumers(deps)) {
      await consumer.handle({ version: 999 })
      await consumer.handle({})
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('hands a readable payload to the application layer', async () => {
    const { deps, run } = dependencies()
    const [requested, decided, withdrawn] = createNotifyOnReviewConsumers(deps)
    const base = {
      version: EVENT_PAYLOAD_VERSION,
      requestId: 'r',
      documentId: 'd',
      workspaceId: 'w',
    }

    await requested?.handle({ ...base, requestedBy: 'u', reviewers: [] })
    await decided?.handle({
      ...base,
      decidedBy: 'u',
      decision: 'approve',
      status: 'approved',
    })
    await withdrawn?.handle({ ...base, withdrawnBy: 'u', reason: 'withdrawn' })

    expect(run).toHaveBeenCalledTimes(3)
  })
})
