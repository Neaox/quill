import { reconcileSources } from '@quill/application'
import type { Clock, UnitOfWork } from '@quill/application'

import type { ScheduledJob } from './job-runner.ts'

/**
 * The daily reconciliation of sourced workspaces (ADR-061, "Freshness"): the
 * safety net for a webhook delivery that never arrived and for a forge or
 * installation with no webhook at all. Each run asks every source to sync,
 * through the same outbox event the webhook writes; the sync job reads the
 * remote's head and stops at once when nothing moved.
 *
 * Every server process runs it on its own timer, so an instance of several
 * processes asks more than once a day. That is harmless: the job is
 * single-flight per source and a request for an unmoved source costs one
 * `ls-remote`.
 */
export function createReconcileSourcesJob(
  deps: { readonly uow: UnitOfWork; readonly clock: Clock },
  intervalMs: number,
): ScheduledJob {
  return {
    name: 'reconcile-sources',
    intervalMs,
    async run(): Promise<void> {
      await reconcileSources(deps)
    },
  }
}
