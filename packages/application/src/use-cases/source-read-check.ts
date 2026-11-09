import type { WorkspaceId } from '@quill/domain'

import { ExternalSourceError } from '../ports/external-source.ts'
import type { ExternalSourceFailure } from '../ports/external-source.ts'
import type { UnitOfWork } from '../ports/persistence.ts'
import type { ExternalSourceProvider, SourceSyncLock } from '../ports/source-sync.ts'
import type { Clock } from '../ports/system.ts'
import { requestSourceSync } from './sync-source.ts'

/**
 * The check on read (ADR-061, "Freshness: one idempotent sync job, three
 * triggers"): opening a sourced document asks whether the source has moved,
 * at most once a minute per source, and asks for a sync when it has.
 *
 * - **Off the request path.** `check` is what a route starts and does not
 *   wait for: the page renders at once from what is stored. The remote's
 *   head is read through the `ExternalSource` port (`ls-remote` in the
 *   adapter), so nothing here knows it is Git.
 * - **Throttled in the process.** Each server process remembers when it last
 *   asked about each source. Several processes may each ask once a minute;
 *   that is a handful of `ls-remote` calls, and the sync they may ask for is
 *   idempotent and single-flight.
 * - **A head that already failed is not asked about again.** When the last
 *   attempt stopped at the revision the remote is at now, asking again would
 *   fail again: the webhook, the reconciliation or "Sync now" retries it.
 * - **The reader is told a sync is under way** (`syncing`) while one runs in
 *   any process, or while one this process asked for has not been attempted
 *   yet, for at most a couple of minutes.
 */

/** How often one process asks a source whether it has moved. */
export const SOURCE_READ_CHECK_INTERVAL_MS = 60_000

/** How long a sync asked for here counts as under way when no attempt has been recorded. */
export const SOURCE_READ_SYNC_WAIT_MS = 2 * 60_000

export interface SourceReadCheckDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly sources: ExternalSourceProvider
}

export type SourceReadCheckResult =
  /** Asked within the last minute; nothing was done. */
  | { readonly kind: 'recent' }
  | { readonly kind: 'not-sourced' }
  /** The remote is at the revision synced, or at the one the last attempt failed on. */
  | { readonly kind: 'current' }
  | { readonly kind: 'requested' }
  /** The remote did not answer; the failure is the sync job's to record, not the reader's. */
  | { readonly kind: 'unreachable'; readonly reason: ExternalSourceFailure }

export interface SourceReadCheck {
  check(workspaceId: WorkspaceId): Promise<SourceReadCheckResult>
  /** Whether a sync this process asked for is still to be attempted. */
  awaitingSync(workspaceId: WorkspaceId, lastAttemptAt: Date | null): boolean
}

export function createSourceReadCheck(deps: SourceReadCheckDependencies): SourceReadCheck {
  const checkedAt = new Map<WorkspaceId, number>()
  const requestedAt = new Map<WorkspaceId, number>()

  return {
    async check(workspaceId) {
      const now = deps.clock.now().getTime()
      const last = checkedAt.get(workspaceId)
      if (last !== undefined && now - last < SOURCE_READ_CHECK_INTERVAL_MS)
        return { kind: 'recent' }
      checkedAt.set(workspaceId, now)

      const connected = await deps.sources.forWorkspace(workspaceId)
      if (connected === null) return { kind: 'not-sourced' }
      let head: string
      try {
        head = await connected.source.head()
      } catch (error) {
        if (error instanceof ExternalSourceError)
          return { kind: 'unreachable', reason: error.reason }
        throw error
      }
      const state = await deps.uow.repos.sourceSyncState.find(workspaceId)
      if (head === state?.lastSyncedRevision || head === state?.failure?.revision) {
        return { kind: 'current' }
      }
      await requestSourceSync(deps, { workspaceId, trigger: 'read' })
      requestedAt.set(workspaceId, deps.clock.now().getTime())
      return { kind: 'requested' }
    },

    awaitingSync(workspaceId, lastAttemptAt) {
      const asked = requestedAt.get(workspaceId)
      if (asked === undefined) return false
      const attempted = lastAttemptAt !== null && lastAttemptAt.getTime() > asked
      const expired = deps.clock.now().getTime() - asked >= SOURCE_READ_SYNC_WAIT_MS
      if (attempted || expired) requestedAt.delete(workspaceId)
      return !attempted && !expired
    },
  }
}

export interface SourceFreshness {
  /** A sync of the source is running, or was asked for and is still to start. */
  readonly syncing: boolean
}

/**
 * What a reader of a sourced document is told while the page is open: whether
 * a sync is under way. It also starts the check on read, without waiting for
 * it; `onCheckFailed` hears about anything the check did not foresee.
 */
export async function readSourceFreshness(
  deps: {
    readonly uow: UnitOfWork
    readonly lock: Pick<SourceSyncLock, 'isHeld'>
    readonly readCheck: SourceReadCheck
    readonly onCheckFailed: (error: unknown) => void
  },
  workspaceId: WorkspaceId,
): Promise<SourceFreshness> {
  void deps.readCheck.check(workspaceId).catch(deps.onCheckFailed)
  const [held, state] = await Promise.all([
    deps.lock.isHeld(workspaceId),
    deps.uow.repos.sourceSyncState.find(workspaceId),
  ])
  return {
    syncing: held || deps.readCheck.awaitingSync(workspaceId, state?.lastAttemptAt ?? null),
  }
}
