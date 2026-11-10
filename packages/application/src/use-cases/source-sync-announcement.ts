import type { WorkspaceId } from '@quill/domain'

import type { UnitOfWork } from '../ports/persistence.ts'
import type { Clock } from '../ports/system.ts'
import { sourceSyncStateChanged } from './events.ts'
import type { SourceSyncState } from './events.ts'

/**
 * Says that a sync started, and then how it ended (ADR-063): a
 * `SourceSyncStateChanged` before the sync runs and another after it, whatever
 * it did. Readers with the workspace open are told by the live stream; the
 * outbox keeps the record, as for every event (ADR-056).
 *
 * The sync is told nothing of this, and is passed through unchanged: what it
 * returned is returned, and what it threw is thrown once the failure has been
 * announced. A sync that ended in a failure it recorded, or threw, ends
 * `failed`; anything else, including finding nothing new, ends `finished`.
 * Only a sync that found the source where it was last left (`up-to-date`)
 * is said to have changed nothing, so a reader refreshes the tree after any
 * other; a failure may have published revisions before it stopped.
 */
export async function announceSourceSync<R extends { readonly kind: string }>(
  deps: { readonly uow: UnitOfWork; readonly clock: Clock },
  workspaceId: WorkspaceId,
  run: () => Promise<R>,
): Promise<R> {
  const announce = (state: SourceSyncState, changed = false) =>
    deps.uow.run((tx) =>
      tx.events.record(sourceSyncStateChanged, { workspaceId, state, changed }, deps.clock.now()),
    )
  await announce('started')
  let result: R
  try {
    result = await run()
  } catch (error) {
    await announce('failed', true)
    throw error
  }
  // A failure may stop part-way, after some revisions were published.
  await announce(result.kind === 'failed' ? 'failed' : 'finished', result.kind !== 'up-to-date')
  return result
}
