import type { Clock, UnitOfWork } from '@quill/application'

import type { SessionConfig } from '../config.ts'
import type { ScheduledJob } from './job-runner.ts'

/**
 * Housekeeping for credentials that have stopped being credentials
 * (ADR-011, review finding M15).
 *
 * Both clocks are already enforced on the way in: a session past its absolute
 * or idle deadline is deleted when somebody presents it, and a spent or
 * expired magic-link token is refused on sight. Neither of those reaches a
 * row nobody comes back for — a laptop that was reinstalled, a reset link
 * that was never clicked — and those rows are the majority. Left alone they
 * accumulate for the life of the instance, each one holding a user id and the
 * hash of a token, for no purpose at all.
 *
 * It runs on the job runner beside the outbox poller rather than as a second
 * process, and takes `now` from the injected clock like everything else, so a
 * test drives it deterministically.
 */

export interface SweepDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly session: SessionConfig
}

export interface SweepOutcome {
  readonly sessions: number
  readonly magicLinks: number
}

/** Hourly: the rows are cheap to keep for an hour and there is no urgency. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000

export async function sweepExpired(deps: SweepDependencies, now: Date): Promise<SweepOutcome> {
  const { repos } = deps.uow
  // The same idle deadline `SessionService.authenticate` applies, computed
  // here rather than in SQL so the two can never drift apart.
  const idleCutoff = new Date(now.getTime() - deps.session.idleTtlMs)
  return {
    sessions: await repos.sessions.deleteExpired({ now, idleCutoff }),
    magicLinks: await repos.magicLinks.deleteSpent(now),
  }
}

export function createSweepJob(deps: SweepDependencies): ScheduledJob {
  return {
    name: 'sweep-expired',
    intervalMs: SWEEP_INTERVAL_MS,
    async run(now: Date): Promise<void> {
      await sweepExpired(deps, now)
    },
  }
}
