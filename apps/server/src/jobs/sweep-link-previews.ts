import type { Clock, UnitOfWork } from '@quill/application'

import type { ScheduledJob } from './job-runner.ts'

/**
 * Forgets link previews nobody has read in a long time (ADR-042).
 *
 * A preview someone still reads is refreshed every few days, as a side effect
 * of being read, so a row last fetched months ago belongs to a link nobody has
 * opened, or to a policy an organisation has since changed (whose private scope
 * nothing reads any more). The rows are derived data, one fetch rebuilds any
 * of them, and left alone they would accumulate for the life of the instance.
 *
 * The retention is long on purpose: a preview of a page that has since died is
 * the only record of what the link was, and the card is better kept than lost.
 */

export const LINK_PREVIEW_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

/** Daily: the rows are small and nothing is urgent. */
export const SWEEP_LINK_PREVIEWS_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface SweepLinkPreviewsDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
}

export async function sweepLinkPreviews(
  deps: SweepLinkPreviewsDependencies,
  now: Date,
): Promise<number> {
  return deps.uow.repos.linkPreviews.deleteFetchedBefore(
    new Date(now.getTime() - LINK_PREVIEW_RETENTION_MS),
  )
}

export function createSweepLinkPreviewsJob(deps: SweepLinkPreviewsDependencies): ScheduledJob {
  return {
    name: 'sweep-link-previews',
    intervalMs: SWEEP_LINK_PREVIEWS_INTERVAL_MS,
    async run(now: Date): Promise<void> {
      await sweepLinkPreviews(deps, now)
    },
  }
}
