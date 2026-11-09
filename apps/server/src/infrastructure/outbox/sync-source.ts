import {
  SOURCE_SYNC_REQUESTED,
  handleSourceSyncRequested,
  notifySourceSyncFailure,
  parseSourceSyncRequested,
} from '@quill/application'

import type { AppDependencies } from '../../dependencies.ts'
import { DeferEvent } from './consumer.ts'
import type { OutboxConsumer } from './consumer.ts'
import type { LaneOptions } from './lane.ts'

/**
 * The one consumer of `SourceSyncRequested` (ADR-061, "Freshness"): runs the
 * sync job of the workspace the event names, with the content store that
 * writes. Every trigger — the manual one today, the webhook, the
 * reconciliation and the check on read later — arrives here.
 *
 * A sync fetches from a remote and may replay a long history, so it runs on a
 * lane of its own (`SOURCE_SYNC_LANE`): never inside the main poller's
 * transaction, and never in the link previews' lane, whose cycles it would
 * hold up for as long as it runs.
 *
 * **A busy source is deferred, not dropped.** Another sync of the same source
 * may have read the remote's head before the change this request is about,
 * so the request waits and runs once that sync has finished. Waiting is not
 * failing, so it does not count against the event's attempts. Every other
 * outcome the job records on the source's sync state itself; only what it did
 * not foresee is thrown, for the outbox to retry.
 *
 * **A failure is told once.** After each attempt that ran, failed or not, the
 * workspace's administrators are told about a failure they have not heard of
 * (`notifySourceSyncFailure`): one notification per distinct failure, not
 * per attempt (ADR-061). It runs after a thrown failure too, before the
 * error goes back to the outbox, since that attempt's failure is recorded.
 */

export const SOURCE_SYNC_LANE = 'sources'

/** How long a request waits while another sync of its source runs. */
export const SOURCE_BUSY_RETRY_MS = 30_000

/**
 * Longer than a whole fetch may take (`GitCliExternalSource`'s deadline is
 * fifteen minutes) plus a long replay, and few at a time: each holds a
 * connection for its lock and works a `git` process hard.
 */
export const SOURCE_SYNC_LANE_OPTIONS = {
  concurrency: 2,
  batchSize: 2,
  handlerTimeoutMs: 30 * 60_000,
  leaseMs: 35 * 60_000,
} as const satisfies Partial<LaneOptions>

export function createSyncSourceConsumer(
  deps: Pick<
    AppDependencies,
    | 'uow'
    | 'format'
    | 'clock'
    | 'ids'
    | 'sourceSync'
    | 'tokens'
    | 'shareLinkPolicy'
    | 'blobStore'
    | 'drawingText'
  > & { readonly config: { readonly attachments: { readonly maxBytes: number } } },
): OutboxConsumer {
  return {
    eventType: SOURCE_SYNC_REQUESTED,
    async handle(payload: unknown): Promise<void> {
      const { uow, format, clock, ids, sourceSync, blobStore, drawingText, config } = deps
      // A repository asset is held to what an upload is (ADR-061, ADR-011).
      const maxAssetBytes = config.attachments.maxBytes
      const job = { uow, format, clock, ids, ...sourceSync, blobStore, drawingText, maxAssetBytes }
      const event = parseSourceSyncRequested(payload)
      if (event === null) return
      const tell = () => notifySourceSyncFailure(deps, event.workspaceId)
      let result: Awaited<ReturnType<typeof handleSourceSyncRequested>>
      try {
        result = await handleSourceSyncRequested(job, payload)
      } catch (error) {
        await tell()
        throw error
      }
      if (result?.kind === 'busy') {
        throw new DeferEvent(SOURCE_BUSY_RETRY_MS, 'another sync of this source is running')
      }
      await tell()
    },
  }
}
