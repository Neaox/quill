import {
  LINK_PREVIEW_REQUESTED,
  LinkPreviewRetryLater,
  fetchLinkPreview,
  parseLinkPreviewRequested,
} from '@quill/application'
import type { LinkPreviewFetchDependencies } from '@quill/application'

import { DeferEvent } from './consumer.ts'
import type { OutboxConsumer } from './consumer.ts'

/**
 * Fetches a link preview in the background (ADR-042).
 *
 * A reader that finds no usable snapshot is shown a plain link and a request is
 * queued; this is what answers it. Doing it here and not on the request means a
 * slow or hostile host costs a job, not a reader's wait. It runs on the outbox's
 * lane for slow work (`lane.ts`), several at a time, so a few slow sites do not
 * hold up anything else the outbox does.
 *
 * Outcomes that say nothing about the link (a rate limit says wait, the
 * fetcher is busy) put the event back for as long as they need and do not count
 * as failed attempts. Only a fault in the work itself uses up retries.
 *
 * The URL is in the payload so the job can run, and a URL may carry a token
 * (a signed link, an unlisted share). Once the job has run, the row keeps who
 * asked and which scope, and only the address of the site, not the path or
 * query: `redactPayload`, as the mail consumer does for its link.
 */

/** What a processed row says instead of the full address. */
export const REDACTED_PATH = '/[redacted after fetch]'

export function createFetchLinkPreviewConsumer(deps: LinkPreviewFetchDependencies): OutboxConsumer {
  return {
    eventType: LINK_PREVIEW_REQUESTED,

    async handle(payload: unknown): Promise<void> {
      try {
        await fetchLinkPreview(deps, payload)
      } catch (error) {
        if (error instanceof LinkPreviewRetryLater) {
          throw new DeferEvent(error.retryAfterMs, error.message)
        }
        throw error
      }
    },

    redactPayload(payload: unknown): unknown {
      const event = parseLinkPreviewRequested(payload)
      if (event === null) return payload
      try {
        return { ...event, url: `${new URL(event.url).origin}${REDACTED_PATH}` }
      } catch {
        return { ...event, url: REDACTED_PATH }
      }
    },
  }
}
