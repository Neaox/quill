/**
 * Capped exponential backoff with jitter, shared by autosave and the lock
 * heartbeat (audit 2026-10-11, P0-1 and P0-4).
 *
 * The jitter is "equal jitter": half of the exponential step is fixed and the
 * other half random, so a hundred tabs that lost the server at the same moment
 * come back spread over a window instead of in one burst, and no retry is ever
 * immediate by accident.
 */
export interface BackoffPolicy {
  /** The first retry's ceiling. */
  readonly baseMs: number
  /** No retry waits longer than this, however many have failed. */
  readonly capMs: number
  /** `Math.random` in production; a fixed value in a test. */
  readonly random?: () => number
  /** A server's `Retry-After`, which is a floor: it knows better than we do. */
  readonly retryAfterMs?: number | null
}

/** The delay before retry number `attempt` (1-based). */
export function backoffDelay(attempt: number, policy: BackoffPolicy): number {
  const random = policy.random ?? Math.random
  const ceiling = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, attempt - 1))
  const jittered = Math.round(ceiling / 2 + (random() * ceiling) / 2)
  return Math.max(jittered, policy.retryAfterMs ?? 0)
}
